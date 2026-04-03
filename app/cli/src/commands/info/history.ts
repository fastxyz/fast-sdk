import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { HistoryStore } from '../../services/history-store.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

const fromOption = Options.text('from').pipe(Options.optional, Options.withDescription('Filter by sender account name or address'));

const toOption = Options.text('to').pipe(Options.optional, Options.withDescription('Filter by recipient address'));

const tokenOption = Options.text('token').pipe(Options.optional, Options.withDescription('Filter by token'));

const limitOption = Options.integer('limit').pipe(Options.withDefault(20), Options.withDescription('Max number of records to return'));

const offsetOption = Options.integer('offset').pipe(Options.withDefault(0), Options.withDescription('Number of records to skip'));

interface PortalActivityRecord {
  transferFastTxId?: string;
  externalTransactionHash?: string;
}

interface PortalActivityListResponse {
  status: 'success' | 'error';
  data: PortalActivityRecord[];
}

/** Infer bridge route from addresses for entries that pre-date the route field. */
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
  // Portal stores transferFastTxId without 0x prefix; CLI stores with 0x prefix
  const normalized = txHash.replace(/^0x/, '').toLowerCase();
  return records.some((r) => r.transferFastTxId?.toLowerCase() === normalized);
}

export const infoHistory = Command.make(
  'history',
  { from: fromOption, to: toOption, token: tokenOption, limit: limitOption, offset: offsetOption },
  (args) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore;
      const networkConfig = yield* NetworkConfigService;
      const output = yield* Output;

      let entries = yield* history.list({
        from: Option.getOrUndefined(args.from),
        to: Option.getOrUndefined(args.to),
        token: Option.getOrUndefined(args.token),
        limit: args.limit,
        offset: args.offset,
      });

      // Refresh status for pending bridge entries by querying the portal.
      // Route is inferred from addresses for old entries that pre-date the route field.
      // - evm-to-fast: query /activity by externalAddress, match externalTransactionHash
      // - fast-to-evm: query /activity by fastSetAddress, match transferFastTxId
      const pendingBridge = entries.filter((e) => {
        if (e.status !== 'pending') return false;
        const route = inferRoute(e);
        return route === 'evm-to-fast' || route === 'fast-to-evm';
      });
      if (pendingBridge.length > 0) {
        yield* Effect.forEach(
          pendingBridge,
          (entry) =>
            Effect.gen(function* () {
              const networkCfg = yield* networkConfig.resolve(entry.network).pipe(Effect.option);
              if (Option.isNone(networkCfg) || !networkCfg.value.allset) return;
              const portalApiUrl = networkCfg.value.allset.portalApiUrl;
              const route = inferRoute(entry);

              const confirmed = yield* Effect.promise(() =>
                route === 'evm-to-fast'
                  ? isDepositConfirmed(portalApiUrl, entry.from, entry.hash)
                  : isWithdrawConfirmed(portalApiUrl, entry.from, entry.hash),
              );
              if (confirmed) {
                yield* history.updateStatus(entry.hash, 'confirmed');
              }
            }),
          { concurrency: 3 },
        );

        // Re-fetch to get updated statuses
        entries = yield* history.list({
          from: Option.getOrUndefined(args.from),
          to: Option.getOrUndefined(args.to),
          token: Option.getOrUndefined(args.token),
          limit: args.limit,
          offset: args.offset,
        });
      }

      yield* output.humanTable(
        ['HASH', 'TYPE', 'FROM', 'TO', 'AMOUNT', 'TOKEN', 'STATUS', 'TIME'],
        entries.map((e) => [
          e.hash.slice(0, 10) + '...',
          e.type,
          e.from.slice(0, 10) + '...',
          e.to.slice(0, 10) + '...',
          e.formatted,
          e.tokenName,
          e.status,
          e.timestamp,
        ]),
      );
      yield* output.success({ transactions: entries });
    }),
).pipe(Command.withDescription('Show transaction history'));
