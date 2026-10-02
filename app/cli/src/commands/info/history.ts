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
  type TransferDirection,
} from '../../services/api/explorer.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { type AccountInfo, AccountStore } from '../../services/storage/account.js';
import { HistoryStore } from '../../services/storage/history.js';
import { NetworkConfigService } from '../../services/storage/network.js';
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

/** Local history is small; read it whole and filter in memory so merged paging stays exact. */
const LOCAL_SCAN_LIMIT = 1_000_000;
/** Upper bound on explorer pages read per side, to keep one call bounded. */
const MAX_NETWORK_PAGES = 10;

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

/** Without an account, read a local entry from the perspective of the account that recorded it. */
const recordedDirection = (entry: HistoryEntry): TransferDirection =>
  entry.from === entry.to ? 'self' : inferRoute(entry) === 'evm-to-fast' ? 'in' : 'out';

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

const timeMs = (timestamp: string): number => {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : 0;
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
      // With no account at all, fall back to the full local log.
      const account = yield* accounts.resolveAccount(config.account).pipe(
        Effect.map(Option.some),
        Effect.catchTag('NoDefaultAccountError', () => Effect.succeed(Option.none<AccountInfo>())),
      );
      const network = yield* networkConfig.resolve(config.network);
      const tokenMatches = makeTokenMatcher(args.token, network);

      // ── Local entries (everything this CLI submitted) ─────────────────────
      const localEntries = yield* history.list({ limit: LOCAL_SCAN_LIMIT, offset: 0 });
      const localRows: HistoryRow[] = localEntries.flatMap((entry): HistoryRow[] => {
        const d = Option.isSome(account) ? localDirection(entry, account.value) : recordedDirection(entry);
        if (d === undefined || !wantDirection(d) || !matchesParty(entry) || !tokenMatches(entry.tokenName, entry.tokenId)) return [];
        return [{ ...entry, direction: d, source: 'local' }];
      });

      // ── Network transfers (incoming and outgoing, from the explorer) ──────
      let networkRows: HistoryRow[] = [];
      const needed = offset + limit;
      if (Option.isNone(account)) {
        warnings.push('No account selected (create one or set a default), so only local history is shown.');
      } else if (!network.explorerApiUrl) {
        warnings.push(`Network "${config.network}" has no explorer API configured (explorerApiUrl); only local history is shown.`);
      } else if (needed > 0) {
        const address = account.value.fastAddress;
        const keep = (t: NetworkTransfer) => wantDirection(t.direction) && matchesParty(t) && tokenMatches(t.tokenName, t.tokenId);
        const sides = (['from', 'to'] as const).filter((side) => {
          if (side === 'from') {
            return direction !== 'in' && (args.from === undefined || sameAddress(args.from, address));
          }
          return direction !== 'out' && (args.to === undefined || sameAddress(args.to, address));
        });

        const collect = (side: 'from' | 'to') =>
          Effect.gen(function* () {
            const kept: NetworkTransfer[] = [];
            let cursor: string | null = null;
            for (let page = 0; page < MAX_NETWORK_PAGES; page++) {
              const result: ExplorerTransfersPage = yield* explorer.listTransfers({
                address,
                side,
                order: 'desc',
                limit: Math.min(EXPLORER_MAX_PAGE_SIZE, Math.max(needed, 50)),
                cursor,
              });
              kept.push(...result.transfers.filter(keep));
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
            warnings.push(`Network history was cut off after ${MAX_NETWORK_PAGES} pages per direction; narrow the filters to see older transfers.`);
          }
          // A local entry with the same Fast transaction hash wins (it keeps the
          // bridge route and status); the from/to feeds overlap on self transfers.
          const localHashes = new Set(localRows.map((row) => normHex(row.hash)));
          const seen = new Set<string>();
          networkRows = fetched.right
            .flatMap((r) => r.kept)
            .filter((t) => {
              const key = `${normHex(t.hash)}-${t.opIndex}`;
              if (localHashes.has(normHex(t.hash)) || seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .map((t) => networkRow(t, config.network));
        }
      }

      const rows = [...networkRows, ...localRows].sort((a, b) => timeMs(b.timestamp) - timeMs(a.timestamp)).slice(offset, offset + limit);

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
