import { mkdtempSync, readFileSync } from 'node:fs';
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

function applySqlMigration(sqlite: Db.Database, filename: string): void {
  const sql = readFileSync(join(__dirname, '../../drizzle', filename), 'utf8');
  sqlite.exec(sql.replaceAll('--> statement-breakpoint', ''));
}

describe('accounts migration', () => {
  it('preserves an existing 0000 single-signer account when applying 0001', () => {
    const sqlite = new Db(':memory:');
    try {
      applySqlMigration(sqlite, '0000_colossal_blizzard.sql');
      sqlite.prepare(`
        INSERT INTO accounts (
          name, fast_address, evm_address, encrypted_key, encrypted, is_default, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'legacy',
        'fast1legacy',
        '0x1234567890abcdef1234567890abcdef12345678',
        Buffer.from('encrypted-private-key'),
        1,
        1,
        '2026-05-04T00:00:00.000Z',
      );

      applySqlMigration(sqlite, '0001_bumpy_komodo.sql');

      const account = sqlite.prepare('SELECT * FROM accounts WHERE name = ?').get('legacy') as {
        name: string;
        kind: string;
        fast_address: string;
        evm_address: string;
        encrypted_key: Buffer;
        encrypted: number;
        multisig_config: string | null;
        is_default: number;
        created_at: string;
      };
      const createSql = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")
        .pluck()
        .get() as string;

      expect(account).toEqual({
        name: 'legacy',
        kind: 'single',
        fast_address: 'fast1legacy',
        evm_address: '0x1234567890abcdef1234567890abcdef12345678',
        encrypted_key: Buffer.from('encrypted-private-key'),
        encrypted: 1,
        multisig_config: null,
        is_default: 1,
        created_at: '2026-05-04T00:00:00.000Z',
      });
      expect(createSql).toContain('accounts_kind_payload_check');
    } finally {
      sqlite.close();
    }
  });

  it('rejects a single-signer row without its EVM address and encryption flag', () => {
    const sqlite = new Db(':memory:');
    try {
      applySqlMigration(sqlite, '0000_colossal_blizzard.sql');
      applySqlMigration(sqlite, '0001_bumpy_komodo.sql');

      const insert = sqlite.prepare(`
          INSERT INTO accounts (
            name, kind, fast_address, evm_address, encrypted_key, encrypted,
            multisig_config, is_default, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      expect(() =>
        insert.run(
          'invalid-single',
          'single',
          'fast1invalidsingle',
          null,
          Buffer.from('encrypted-private-key'),
          null,
          null,
          0,
          '2026-09-16T00:00:00.000Z',
        ),
      ).toThrow(/accounts_kind_payload_check/);
    } finally {
      sqlite.close();
    }
  });

  it('rejects a multisig row carrying single-signer-only fields', () => {
    const sqlite = new Db(':memory:');
    try {
      applySqlMigration(sqlite, '0000_colossal_blizzard.sql');
      applySqlMigration(sqlite, '0001_bumpy_komodo.sql');

      const insert = sqlite.prepare(`
          INSERT INTO accounts (
            name, kind, fast_address, evm_address, encrypted_key, encrypted,
            multisig_config, is_default, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      expect(() =>
        insert.run(
          'invalid-multisig',
          'multisig',
          'fast1invalidmultisig',
          '0xdead',
          null,
          1,
          '{}',
          0,
          '2026-09-16T00:00:00.000Z',
        ),
      ).toThrow(/accounts_kind_payload_check/);
    } finally {
      sqlite.close();
    }
  });
});

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

  it('rolls back the insert and preserves the prior default when default switching fails', async () => {
    const sqlite = new Db(':memory:');
    try {
      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
      const dbServiceLayer = Layer.succeed(DatabaseService, {
        query: <A>(fn: (db: never) => A, message: string) =>
          Effect.try({
            try: () => fn(db as never),
            catch: (cause) => new DatabaseError({ message, cause }),
          }),
      } as never);
      const accountLayer = AccountStore.Default.pipe(Layer.provide(dbServiceLayer));

      await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* AccountStore;
          yield* store.create('alice', new Uint8Array(32).fill(1), null);
        }).pipe(Effect.provide(accountLayer)),
      );

      sqlite.exec(`
        CREATE TRIGGER fail_treasury_default
        BEFORE UPDATE OF is_default ON accounts
        WHEN NEW.name = 'treasury' AND NEW.is_default = 1
        BEGIN
          SELECT RAISE(ABORT, 'injected default switch failure');
        END;
      `);

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const store = yield* AccountStore;
          return yield* store.createMultiSig(
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
        }).pipe(Effect.provide(accountLayer)),
      );

      expect(exit._tag).toBe('Failure');
      expect(sqlite.prepare('SELECT name, is_default FROM accounts ORDER BY name').all()).toEqual([{ name: 'alice', is_default: 1 }]);
    } finally {
      sqlite.close();
    }
  });
});
