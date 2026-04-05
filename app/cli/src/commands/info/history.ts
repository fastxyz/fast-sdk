import { defineCommand } from 'citty';
import { Effect, Option } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { HistoryStore } from '../../services/history-store.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

interface PortalActivityRecord {
  transferFastTxId?: string;
  externalTransactionHash?: string;
}

interface PortalActivityListResponse {
  status: 'success' | 'error';
  data: PortalActivityRecord[];
}

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

export const infoHistory = defineCommand({
  meta: { name: 'history', description: 'Show transaction history' },
  args: {
    ...globalArgs,
    from: { type: 'string', description: 'Filter by sender account name or address' },
    to: { type: 'string', description: 'Filter by recipient address' },
    token: { type: 'string', description: 'Filter by token' },
    limit: { type: 'string', description: 'Max number of records to return', default: '20' },
    offset: { type: 'string', description: 'Number of records to skip', default: '0' },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const history = yield* HistoryStore;
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    const limit = Number(args.limit);
    const offset = Number(args.offset);

    let entries = yield* history.list({
      from: args.from,
      to: args.to,
      token: args.token,
      limit,
      offset,
    });

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

      entries = yield* history.list({
        from: args.from,
        to: args.to,
        token: args.token,
        limit,
        offset,
      });
    }

    yield* output.humanTable(
      ['HASH', 'TYPE', 'FROM', 'TO', 'AMOUNT', 'TOKEN', 'STATUS', 'TIME'],
      entries.map((e) => [
        `${e.hash.slice(0, 10)}...`,
        e.type,
        `${e.from.slice(0, 10)}...`,
        `${e.to.slice(0, 10)}...`,
        e.formatted,
        e.tokenName,
        e.status,
        e.timestamp,
      ]),
    );
    yield* output.success({ transactions: entries });
  })),
});
