import { toHex } from '@fastxyz/sdk';
import { Effect, Option } from 'effect';
import type { InfoHistoryArgs } from '../../cli.js';
import { InvalidUsageError } from '../../errors/index.js';
import type { HistoryEntry } from '../../schemas/history.js';
import type { NetworkConfig } from '../../schemas/networks.js';
import { formatBaseUnits } from '../../services/amount.js';
import {
  EXPLORER_MAX_PAGE_SIZE,
  ExplorerApi,
  type ExplorerTransfersPage,
  historyTypeOf,
  type NetworkTransfer,
  parseIsoTimestampNs,
  type TransferDirection,
} from '../../services/api/explorer.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { type AccountInfo, AccountStore } from '../../services/storage/account.js';
import { HistoryStore } from '../../services/storage/history.js';
import { NetworkConfigService } from '../../services/storage/network.js';
import { ensureMultisigNetwork } from '../../services/signer-resolver.js';
import { resolveToken } from '../../services/token-resolver.js';
import type { Command } from '../index.js';

interface PortalActivityRecord {
  transferFastTxId?: string;
  externalTransactionHash?: string;
}

interface PortalActivityListResponse {
  status: 'success' | 'error';
  data: PortalActivityRecord[];
}

/** A history row: a local entry or a network transfer, with its direction and origin. */
export type HistoryRow = HistoryEntry & {
  /** Relative to the selected account: `in`, `out`, or `self` (both sides). */
  readonly direction: TransferDirection;
  /** `network`: read from the explorer API; `local`: recorded by this CLI when it submitted the transaction. */
  readonly source: 'network' | 'local';
};

/** Local entries are read newest-first in batches of this size, stopping once a page's worth has matched. */
const LOCAL_BATCH = 200;
/**
 * Extra local matches read beyond `offset + limit`, so a network transfer near
 * the page boundary still finds the local entry for the same transaction (their
 * timestamps can differ slightly) and is shown once.
 */
const LOCAL_DEDUPE_SLACK = 20;
/**
 * Explorer pages read per side beyond the ones `offset + limit` needs, for rows
 * the filters drop. Bounds a filter that matches nothing on a busy account.
 */
const EXTRA_NETWORK_PAGES = 20;

function inferRoute(entry: { route: 'fast' | 'evm-to-fast' | 'fast-to-evm'; from: string; to: string }): 'fast' | 'evm-to-fast' | 'fast-to-evm' {
  if (entry.route !== 'fast') return entry.route;
  if (entry.from.startsWith('0x') && entry.to.startsWith('fast1')) return 'evm-to-fast';
  if (entry.from.startsWith('fast1') && entry.to.startsWith('0x')) return 'fast-to-evm';
  return 'fast';
}

async function queryActivityList(portalApiUrl: string, params: string): Promise<PortalActivityRecord[]> {
  try {
    const res = await fetch(`${portalApiUrl}/activity?${params}&page_size=50`);
    if (!res.ok) return [];
    const json = (await res.json()) as PortalActivityListResponse;
    return json.status === 'success' ? json.data : [];
  } catch {
    return [];
  }
}

async function isDepositConfirmed(portalApiUrl: string, evmAddress: string, txHash: string): Promise<boolean> {
  const records = await queryActivityList(portalApiUrl, `externalAddress=${encodeURIComponent(evmAddress)}`);
  return records.some((r) => r.externalTransactionHash?.toLowerCase() === txHash.toLowerCase());
}

async function isWithdrawConfirmed(portalApiUrl: string, fastAddress: string, txHash: string): Promise<boolean> {
  const records = await queryActivityList(portalApiUrl, `fastSetAddress=${encodeURIComponent(fastAddress)}`);
  const normalized = txHash.replace(/^0x/, '').toLowerCase();
  return records.some((r) => r.transferFastTxId?.toLowerCase() === normalized);
}

const normHex = (value: string): string => value.replace(/^0x/i, '').toLowerCase();
const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Direction of a local entry relative to the selected account. The account's
 * EVM address counts as its own for bridge deposits it funded (`from`), so a
 * self-funded EVM → Fast deposit is `in`, like the matching Mint on Fast.
 * Returns undefined when the entry does not involve the account.
 */
export const localDirection = (entry: HistoryEntry, account: AccountInfo): TransferDirection | undefined => {
  const isTo = sameAddress(entry.to, account.fastAddress);
  const fromFast = sameAddress(entry.from, account.fastAddress);
  const fromEvm = account.kind === 'single' && sameAddress(entry.from, account.evmAddress);
  if (isTo && fromFast) return 'self';
  if (isTo) return 'in';
  if (fromFast || fromEvm) return 'out';
  return undefined;
};

/** Without a selected account, use the EVM sender to identify who recorded a bridge deposit. */
const recordedDirection = (entry: HistoryEntry, localAccounts: readonly AccountInfo[]): TransferDirection => {
  if (entry.from === entry.to) return 'self';
  if (inferRoute(entry) !== 'evm-to-fast') return 'out';

  const recorder = localAccounts.find((account) => account.kind === 'single' && sameAddress(account.evmAddress, entry.from));
  if (recorder) return sameAddress(entry.to, recorder.fastAddress) ? 'in' : 'out';
  // An old entry may outlive its recording account. Only call it incoming if
  // the destination still belongs to a local account.
  return localAccounts.some((account) => sameAddress(account.fastAddress, entry.to)) ? 'in' : 'out';
};

const networkRow = (t: NetworkTransfer, networkName: string): HistoryRow => ({
  hash: t.hash,
  type: historyTypeOf(t.type),
  from: t.from,
  to: t.to,
  amount: t.amount.toString(),
  // Tokens the network config does not know have no decimals: show base units.
  formatted: t.decimals === null ? t.amount.toString() : formatBaseUnits(t.amount, t.decimals),
  tokenName: t.tokenName,
  tokenId: t.tokenId,
  network: networkName,
  status: 'confirmed',
  timestamp: t.timestamp,
  explorerUrl: t.explorerUrl,
  route: 'fast',
  chainId: null,
  direction: t.direction,
  source: 'network',
});

/** `--token` matches a token's name (case-insensitive), its id, or the id the name resolves to on this network. */
const makeTokenMatcher = (token: string | undefined, network: NetworkConfig | undefined) => {
  if (token === undefined) return () => true;
  const wanted = token.toLowerCase();
  let resolvedId: string | undefined;
  if (network) {
    try {
      resolvedId = normHex(toHex(resolveToken(token, network).fastTokenId));
    } catch {
      resolvedId = undefined;
    }
  }
  return (tokenName: string, tokenId: string) =>
    tokenName.toLowerCase() === wanted || normHex(tokenId) === normHex(token) || (resolvedId !== undefined && normHex(tokenId) === resolvedId);
};

/** Newest first by exact time; equal times keep their order (Array.prototype.sort is stable). */
const byTimeDesc =
  (keyOf: (row: HistoryRow) => bigint) =>
  (a: HistoryRow, b: HistoryRow): number => {
    const d = keyOf(b) - keyOf(a);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  };

export const infoHistory: Command<InfoHistoryArgs> = {
  cmd: 'info-history',
  handler: (args: InfoHistoryArgs) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore;
      const networkConfig = yield* NetworkConfigService;
      const accounts = yield* AccountStore;
      const explorer = yield* ExplorerApi;
      const config = yield* ClientConfig;
      const output = yield* Output;

      const limit = args.limit;
      const offset = args.offset;
      const direction = args.direction ?? 'all';

      if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 0) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: '--limit must be a non-negative integer',
          }),
        );
      }
      if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < 0) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: '--offset must be a non-negative integer',
          }),
        );
      }

      const warnings: string[] = [];
      const wantDirection = (d: TransferDirection) => direction === 'all' || d === direction;
      const matchesParty = (row: { from: string; to: string }) =>
        (args.from === undefined || sameAddress(row.from, args.from)) && (args.to === undefined || sameAddress(row.to, args.to));

      // History is shown for the selected account (--account, else the default).
      // With no account at all, fall back to the full local log. `--local` keeps
      // the pre-network behaviour: only the local log, for every local account,
      // unless --account narrows it to one.
      const localOnly = args.local === true;
      const account =
        localOnly && Option.isNone(config.account)
          ? Option.none<AccountInfo>()
          : yield* accounts.resolveAccount(config.account).pipe(
              Effect.map(Option.some),
              Effect.catchTag('NoDefaultAccountError', () => Effect.succeed(Option.none<AccountInfo>())),
            );
      const network = yield* networkConfig.resolve(config.network);
      if (!localOnly && Option.isSome(account) && account.value.kind === 'multisig') {
        yield* ensureMultisigNetwork(account.value, config.network);
      }
      const localAccounts = Option.isNone(account) ? yield* accounts.list() : [];
      const tokenMatches = makeTokenMatcher(args.token, network);

      const needed = offset + limit;

      // ── Local entries (everything this CLI submitted) ─────────────────────
      // Read newest-first in batches and stop once enough have matched for this
      // page (plus a little slack for de-duplication), instead of loading the
      // whole log.
      const localRows: HistoryRow[] = [];
      for (let scanned = 0; ; scanned += LOCAL_BATCH) {
        const batch = yield* history.list({ limit: LOCAL_BATCH, offset: scanned });
        for (const entry of batch) {
          const d = Option.isSome(account) ? localDirection(entry, account.value) : recordedDirection(entry, localAccounts);
          if (d === undefined || !wantDirection(d) || !matchesParty(entry) || !tokenMatches(entry.tokenName, entry.tokenId)) continue;
          localRows.push({ ...entry, direction: d, source: 'local' });
        }
        if (batch.length < LOCAL_BATCH || localRows.length >= needed + LOCAL_DEDUPE_SLACK) break;
      }

      // ── Network transfers (incoming and outgoing, from the explorer) ──────
      let networkRows: HistoryRow[] = [];
      // Exact (nanosecond) times of network rows; their `timestamp` field only
      // keeps milliseconds, which would leave same-millisecond rows unordered.
      const exactTime = new Map<HistoryRow, bigint>();
      if (localOnly) {
        // --local: the explorer is not consulted (pending bridge entries are still
        // re-checked against the AllSet portal below, as before).
      } else if (Option.isNone(account)) {
        warnings.push('No account selected (create one or set a default), so only local history is shown.');
      } else if (!network.explorerApiUrl) {
        warnings.push(`Network "${config.network}" has no explorer API configured (explorerApiUrl); only local history is shown.`);
      } else if (needed > 0) {
        const address = account.value.fastAddress;
        const sides = (['from', 'to'] as const).filter((side) => {
          if (side === 'from') {
            return direction !== 'in' && (args.from === undefined || sameAddress(args.from, address));
          }
          return direction !== 'out' && (args.to === undefined || sameAddress(args.to, address));
        });
        // Rows are de-duplicated while they are collected, so each feed stops
        // only once it holds `offset + limit` rows that will actually be shown:
        // a local entry with the same Fast transaction hash wins (it keeps the
        // bridge route and status). A same-address transfer appears in both
        // feeds, so take it from the incoming feed only, including Burns whose
        // displayed direction remains `out`.
        const localHashes = new Set(localRows.map((row) => normHex(row.hash)));
        const keep = (side: 'from' | 'to') => (t: NetworkTransfer) =>
          wantDirection(t.direction) &&
          matchesParty(t) &&
          tokenMatches(t.tokenName, t.tokenId) &&
          !localHashes.has(normHex(t.hash)) &&
          !(side === 'from' && sides.length === 2 && sameAddress(t.from, t.to));

        // Enough pages to reach `offset + limit` rows, plus room for rows the
        // filters drop, so deep `--offset` values still reach older transfers.
        const pageSize = Math.min(EXPLORER_MAX_PAGE_SIZE, Math.max(needed, 50));
        const maxPages = Math.ceil(needed / pageSize) + EXTRA_NETWORK_PAGES;
        const collect = (side: 'from' | 'to') =>
          Effect.gen(function* () {
            const kept: NetworkTransfer[] = [];
            let cursor: string | null = null;
            for (let page = 0; page < maxPages; page++) {
              const result: ExplorerTransfersPage = yield* explorer.listTransfers({
                address,
                side,
                order: 'desc',
                limit: pageSize,
                cursor,
              });
              kept.push(...result.transfers.filter(keep(side)));
              if (kept.length >= needed || !result.hasMore || result.nextCursor === null) {
                return { kept, truncated: false };
              }
              cursor = result.nextCursor;
            }
            return { kept, truncated: true };
          });

        const fetched = yield* Effect.all(sides.map(collect), { concurrency: 'unbounded' }).pipe(Effect.either);
        if (fetched._tag === 'Left') {
          warnings.push(`${fetched.left.message.replace(/\.$/, '')}. Showing local history only; incoming payments may be missing.`);
        } else {
          if (fetched.right.some((r) => r.truncated)) {
            warnings.push(
              `Network history was cut off after ${maxPages} pages per direction before enough transfers matched the filters; older matching transfers may be missing.`,
            );
          }
          const seen = new Set<string>();
          networkRows = fetched.right
            .flatMap((r) => r.kept)
            .filter((t) => {
              const key = `${normHex(t.hash)}-${t.opIndex}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .map((t) => {
              const row = networkRow(t, config.network);
              exactTime.set(row, t.timestampNs);
              return row;
            });
        }
      }

      // Local entries carry their recorded ISO time; network rows their exact explorer time.
      const keyOf = (row: HistoryRow): bigint => exactTime.get(row) ?? parseIsoTimestampNs(row.timestamp) ?? 0n;
      const rows = [...networkRows, ...localRows].sort(byTimeDesc(keyOf)).slice(offset, offset + limit);

      // Refresh pending bridge entries on this page against the AllSet portal.
      const pendingBridge = rows.filter((e) => {
        if (e.source !== 'local' || e.status !== 'pending') return false;
        const route = inferRoute(e);
        return route === 'evm-to-fast' || route === 'fast-to-evm';
      });
      const confirmed = new Set<string>();
      if (pendingBridge.length > 0) {
        yield* Effect.forEach(
          pendingBridge,
          (entry) =>
            Effect.gen(function* () {
              const networkCfg = yield* networkConfig.resolve(entry.network).pipe(Effect.option);
              if (Option.isNone(networkCfg) || !networkCfg.value.allSet) return;
              const portalApiUrl = networkCfg.value.allSet.portalApiUrl;
              const route = inferRoute(entry);

              const isConfirmed = yield* Effect.promise(() =>
                route === 'evm-to-fast'
                  ? isDepositConfirmed(portalApiUrl, entry.from, entry.hash)
                  : isWithdrawConfirmed(portalApiUrl, entry.from, entry.hash),
              );
              if (isConfirmed) {
                yield* history.updateStatus(entry.hash, 'confirmed');
                confirmed.add(entry.hash);
              }
            }),
          { concurrency: 3 },
        );
      }
      const transactions = rows.map((row) => (confirmed.has(row.hash) ? { ...row, status: 'confirmed' } : row));

      const routeLabel: Record<string, string> = {
        fast: 'Fast → Fast transfer',
        'evm-to-fast': 'EVM → Fast transfer',
        'fast-to-evm': 'Fast → EVM transfer',
      };

      yield* output.humanTable(
        ['HASH', 'TYPE', 'DIRECTION', 'FROM', 'TO', 'AMOUNT', 'TOKEN', 'STATUS', 'TIME', 'SOURCE'],
        transactions.map((e) => [
          `${e.hash.slice(0, 10)}...`,
          e.type === 'transfer' ? (routeLabel[inferRoute(e)] ?? e.type) : e.type,
          e.direction,
          `${e.from.slice(0, 10)}...`,
          `${e.to.slice(0, 10)}...`,
          e.formatted,
          e.tokenName,
          e.status,
          e.timestamp,
          e.source,
        ]),
      );
      for (const warning of warnings) {
        yield* output.warn(warning);
      }
      yield* output.ok({
        transactions,
        account: Option.isSome(account) ? account.value.fastAddress : null,
        warnings,
      });
    }),
};
