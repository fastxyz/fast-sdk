import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Effect, Layer, Option } from 'effect';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { infoHistory } from '../../src/commands/info/history.js';
import { bundledNetworks } from '../../src/config/networks.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import { ExplorerApi } from '../../src/services/api/explorer.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { AccountStore } from '../../src/services/storage/account.js';
import { DatabaseService } from '../../src/services/storage/database.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));

describe('history recorded direction', () => {
  it('keeps an outbound deposit outgoing after deleting its recording account', async () => {
    const sqlite = new Database(':memory:');
    try {
      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder });
      const databaseLayer = Layer.succeed(DatabaseService, {
        query: <A>(fn: (db: typeof db) => A) => Effect.sync(() => fn(db)),
      } as never);
      const accountLayer = AccountStore.Default.pipe(Layer.provide(databaseLayer));
      const historyLayer = HistoryStore.Default.pipe(Layer.provide(databaseLayer));
      const storageLayer = Layer.merge(accountLayer, historyLayer);
      const hash = `0x${'ab'.repeat(32)}`;

      await Effect.runPromise(
        Effect.gen(function* () {
          const accounts = yield* AccountStore;
          const history = yield* HistoryStore;
          const sender = yield* accounts.create('sender', new Uint8Array(32).fill(1), null);
          const recipient = yield* accounts.create('recipient', new Uint8Array(32).fill(2), null);
          yield* history.record({
            hash,
            type: 'transfer',
            from: sender.evmAddress,
            to: recipient.fastAddress,
            amount: '1',
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
          });
          yield* accounts.setDefault('recipient');
          yield* accounts.delete('sender');
          expect((yield* accounts.list()).map((account) => account.name)).toEqual(['recipient']);
        }).pipe(Effect.provide(storageLayer)),
      );

      const results: Array<{ transactions: Array<{ hash: string; direction: string }> }> = [];
      const cliLayer = Layer.mergeAll(
        storageLayer,
        Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(bundledNetworks.testnet!) } as never),
        Layer.succeed(ClientConfig, {
          json: true,
          debug: false,
          nonInteractive: true,
          network: 'testnet',
          account: Option.none(),
          password: Option.none(),
        }),
        Layer.succeed(ExplorerApi, { listTransfers: () => Effect.die('local history must not query explorer') } as never),
        Layer.succeed(Output, {
          humanTable: () => Effect.void,
          humanLine: () => Effect.void,
          warn: () => Effect.void,
          ok: (data: unknown) => Effect.sync(() => void results.push(data as (typeof results)[number])),
          debug: () => Effect.void,
        } as never),
      );

      await Effect.runPromise(infoHistory.handler({ local: true, direction: 'in', limit: 20, offset: 0 } as never).pipe(Effect.provide(cliLayer)));
      await Effect.runPromise(infoHistory.handler({ local: true, direction: 'out', limit: 20, offset: 0 } as never).pipe(Effect.provide(cliLayer)));

      expect(results[0]?.transactions).toEqual([]);
      expect(results[1]?.transactions).toEqual([expect.objectContaining({ hash, direction: 'out' })]);
    } finally {
      sqlite.close();
    }
  });

  it('persists the direction through a SQLite readback', async () => {
    const sqlite = new Database(':memory:');
    try {
      const db = drizzle(sqlite, { schema });
      migrate(db, { migrationsFolder });
      const databaseLayer = Layer.succeed(DatabaseService, {
        query: <A>(fn: (db: typeof db) => A) => Effect.sync(() => fn(db)),
      } as never);
      const layer = HistoryStore.Default.pipe(Layer.provide(databaseLayer));
      const recorded: HistoryEntry = {
        hash: `0x${'ab'.repeat(32)}`,
        type: 'transfer',
        from: `0x${'11'.repeat(20)}`,
        to: 'fast1recipient',
        amount: '1',
        formatted: '1',
        tokenName: 'testUSDC',
        tokenId: `0x${'22'.repeat(32)}`,
        network: 'testnet',
        status: 'pending',
        timestamp: '2026-10-05T00:00:00.000Z',
        explorerUrl: null,
        route: 'evm-to-fast',
        chainId: 1,
        recordedDirection: 'out',
      };

      const readback = await Effect.runPromise(
        Effect.gen(function* () {
          const history = yield* HistoryStore;
          yield* history.record(recorded);
          return yield* history.getByHash(recorded.hash);
        }).pipe(Effect.provide(layer)),
      );

      expect(readback.recordedDirection).toBe('out');
    } finally {
      sqlite.close();
    }
  });
});
