import { Effect, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { infoTx } from '../../src/commands/info/tx.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { OutputLive } from '../../src/services/output.js';
import { HistoryStore } from '../../src/services/storage/history.js';

describe('info tx', () => {
  it('omits recordedDirection from public transaction-detail JSON', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const entry: HistoryEntry = {
      hash,
      type: 'transfer',
      from: `0x${'11'.repeat(20)}`,
      to: 'fast1recipient',
      amount: '1000000',
      formatted: '1',
      tokenName: 'testUSDC',
      tokenId: `0x${'22'.repeat(32)}`,
      network: 'testnet',
      status: 'confirmed',
      timestamp: '2026-10-05T00:00:00.000Z',
      explorerUrl: null,
      route: 'evm-to-fast',
      chainId: 1,
      recordedDirection: 'out',
    };
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      const configLayer = Layer.succeed(ClientConfig, {
        json: true,
        debug: false,
        nonInteractive: true,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      });
      const layer = Layer.mergeAll(
        configLayer,
        OutputLive.pipe(Layer.provide(configLayer)),
        Layer.succeed(HistoryStore, { getByHash: () => Effect.succeed(entry) } as never),
      );

      await Effect.runPromise(infoTx.handler({ hash } as never).pipe(Effect.provide(layer)));

      expect(JSON.parse(writes.join(''))).toEqual({
        ok: true,
        data: expect.objectContaining({ hash, route: 'evm-to-fast' }),
      });
      expect(JSON.parse(writes.join('')).data).not.toHaveProperty('recordedDirection');
      expect(entry.recordedDirection).toBe('out');
    } finally {
      stdout.mockRestore();
    }
  });
});
