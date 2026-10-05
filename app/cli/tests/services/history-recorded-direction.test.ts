import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Effect, Layer } from 'effect';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import { DatabaseService } from '../../src/services/storage/database.js';
import { HistoryStore } from '../../src/services/storage/history.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));

describe('history recorded direction', () => {
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
