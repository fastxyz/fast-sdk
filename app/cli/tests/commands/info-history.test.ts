import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { infoHistory } from '../../src/commands/info/history.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import { Output } from '../../src/services/output.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const entry = (type: HistoryEntry['type'], route: HistoryEntry['route'] = 'fast'): HistoryEntry => ({
  hash: `0x${type}`,
  type,
  from: 'fast1sender',
  to: 'fast1recipient',
  amount: '1',
  formatted: '1',
  tokenName: 'testUSDC',
  tokenId: '0x01',
  network: 'testnet',
  status: 'confirmed',
  timestamp: '2026-09-16T00:00:00.000Z',
  explorerUrl: null,
  route,
  chainId: null,
});

describe('info history human labels', () => {
  it('uses token operation types instead of the Fast transfer route label', async () => {
    const rows: string[][] = [];
    const entries = [
      entry('token-create'),
      entry('token-mint'),
      entry('token-burn'),
      entry('token-manage'),
      entry('transfer'),
    ];
    const layer = Layer.mergeAll(
      Layer.succeed(HistoryStore, {
        list: () => Effect.succeed(entries),
        updateStatus: () => Effect.void,
      } as never),
      Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(undefined) } as never),
      Layer.succeed(Output, {
        humanTable: (_headers: string[], tableRows: string[][]) => Effect.sync(() => rows.push(...tableRows)),
        humanLine: () => Effect.void,
        ok: () => Effect.void,
        fail: () => Effect.void,
        debug: () => Effect.void,
      } as never),
    );

    await Effect.runPromise(
      infoHistory.handler({ limit: 20, offset: 0 } as never).pipe(Effect.provide(layer)),
    );

    expect(rows.map((row) => row[1])).toEqual([
      'token-create',
      'token-mint',
      'token-burn',
      'token-manage',
      'Fast → Fast transfer',
    ]);
  });
});
