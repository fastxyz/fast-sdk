import { Effect, Layer } from 'effect';
import { bundledNetworks } from '../../src/config/networks.js';
import type { NetworkConfig } from '../../src/schemas/networks.js';
import {
  ExplorerApi,
  type ExplorerTransfersPage,
  type ListTransfersParams,
  type NetworkTransfer,
  normalizeTransfer,
  parseExplorerTransfersResponse,
} from '../../src/services/api/explorer.js';

/** Valid bech32m fast1 addresses (32-byte payloads). */
export const ME = 'fast1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsmkez2q';
export const LEO = 'fast1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qgz8hnv';
export const BRIDGE = 'fast1xvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvesnht6ez';
export const OTHER = 'fast1g3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zqxn9e9u';

export const TESTUSDC_ID = '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46';
export const FASTUSD_ID = '0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130';
export const UNKNOWN_TOKEN_ID = `0x${'42'.repeat(32)}`;

export const testnet = bundledNetworks.testnet!;
export const mainnet = bundledNetworks.mainnet!;

export const hashOf = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

/** One row exactly as the explorer API sends it. */
export const rawTransfer = (overrides: Record<string, unknown> = {}) => ({
  hash: hashOf(1),
  from: LEO,
  to: ME,
  nonce: 7,
  submission_timestamp: '2026-10-02T02:59:49.705580Z',
  type: 'TokenTransfer',
  token_id: TESTUSDC_ID,
  amount: '186a0',
  op_index: 0,
  content: '{"user_data":null}',
  signing_duration_nanos: 1_234_000,
  ...overrides,
});

/** Normalize raw rows for `address`, the way the live service does. */
export const transfersFor = (address: string, rows: Record<string, unknown>[], network: NetworkConfig = testnet): NetworkTransfer[] => {
  const page = parseExplorerTransfersResponse({ transfers: rows, has_more: false, next_cursor: null });
  if (typeof page === 'string') throw new Error(page);
  return page.rows.flatMap((row) => normalizeTransfer(row, address, network) ?? []);
};

export const page = (transfers: NetworkTransfer[], extra: Partial<ExplorerTransfersPage> = {}): ExplorerTransfersPage => ({
  transfers,
  hasMore: false,
  nextCursor: null,
  oldestTimestampMs: transfers.length === 0 ? null : Math.min(...transfers.map((t) => t.timestampMs)),
  ...extra,
});

/** ExplorerApi mock that records calls and answers with `respond`. */
export const mockExplorer = (respond: (params: ListTransfersParams, call: number) => Effect.Effect<ExplorerTransfersPage, unknown>) => {
  const calls: ListTransfersParams[] = [];
  const layer = Layer.succeed(ExplorerApi, {
    listTransfers: (params) => Effect.suspend(() => respond(params, calls.push(params) - 1)) as never,
  });
  return { calls, layer };
};
