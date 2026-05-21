import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Db from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { AccountStore } from '../../src/services/storage/account.js';
import { DatabaseService } from '../../src/services/storage/database.js';
import { DatabaseError } from '../../src/errors/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('AccountStore.createMultiSig', () => {
  it('inserts a multisig row and reads it back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fast-cli-test-'));
    const dbPath = join(dir, 'fast.db');
    const sqlite = new Db(dbPath);
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });

    const dbServiceLayer = Layer.succeed(DatabaseService, {
      query: <A>(fn: (db: never) => A, message: string) =>
        Effect.try({
          try: () => fn(db as never),
          catch: (cause) => new DatabaseError({ message, cause }),
        }),
    } as never);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* AccountStore;
        const created = yield* store.createMultiSig(
          {
            version: 1,
            name: 'treasury',
            signers: ['fast1aaaa', 'fast1bbbb'],
            quorum: 2,
            configNonce: '0',
            fastAddress: 'fast1xyz',
            network: 'testnet',
          },
          true,
        );
        const fetched = yield* store.get('treasury');
        return { created, fetched };
      }).pipe(Effect.provide(AccountStore.Default.pipe(Layer.provide(dbServiceLayer)))),
    );

    expect(result.created.kind).toBe('multisig');
    expect(result.created.name).toBe('treasury');
    expect(result.created.fastAddress).toBe('fast1xyz');
    expect(result.created.isDefault).toBe(true);

    expect(result.fetched.kind).toBe('multisig');
    if (result.fetched.kind !== 'multisig') throw new Error('unreachable');
    expect(result.fetched.multisigConfig.quorum).toBe(2);
    expect(result.fetched.multisigConfig.signers).toEqual(['fast1aaaa', 'fast1bbbb']);
    expect(result.fetched.multisigConfig.name).toBe('treasury');
    expect(result.fetched.fastAddress).toBe('fast1xyz');
  });
});
