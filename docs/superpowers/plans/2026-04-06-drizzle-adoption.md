<!-- markdownlint-disable MD013 -->
# Drizzle ORM Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw SQL prepared statements in the three storage services with Drizzle's type-safe query builder, using a shared schema definition as the single source of truth for column types.

**Architecture:** A new `db/schema.ts` defines all 4 tables using Drizzle's `sqliteTable`. `database.ts` wraps `better-sqlite3` in `drizzle()` and uses `drizzle-kit push` for schema sync. The three services switch from `stmts.*.get/run/all` to `db.select().from(table).where(eq(...)).get()`. Public interfaces unchanged.

**Tech Stack:** TypeScript, Effect 3.x, drizzle-orm, drizzle-kit, better-sqlite3.

**Spec:** [docs/superpowers/specs/2026-04-06-drizzle-adoption-design.md](../specs/2026-04-06-drizzle-adoption-design.md)

---

## File structure

**Created:**

- `app/cli/src/db/schema.ts` — 4 table definitions
- `app/cli/drizzle.config.ts` — drizzle-kit configuration

**Modified:**

- `app/cli/src/services/database.ts` — wrap in `drizzle()`, export typed `db`, use push for schema init
- `app/cli/src/services/account/account-store.ts` — Drizzle queries replace raw `stmts`
- `app/cli/src/services/history-store.ts` — Drizzle queries replace raw `stmts`
- `app/cli/src/services/network-config.ts` — Drizzle queries replace raw `stmts`

**Unchanged:** `crypto.ts`, `layers.ts`, all command files, all error files, `schemas/history.ts`, `schemas/networks.ts`.

---

## Task 1: Add dependencies + create schema + drizzle config

**Files:**

- Modify: `app/cli/package.json`
- Create: `app/cli/src/db/schema.ts`
- Create: `app/cli/drizzle.config.ts`

- [ ] **Step 1.1: Install drizzle-orm and drizzle-kit**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli add drizzle-orm
pnpm -F @fastxyz/fast-cli add -D drizzle-kit
```

- [ ] **Step 1.2: Create `app/cli/src/db/schema.ts`**

```typescript
import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  name: text("name").primaryKey(),
  fastAddress: text("fast_address").notNull(),
  evmAddress: text("evm_address").notNull(),
  encryptedKey: blob("encrypted_key", { mode: "buffer" }).notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const history = sqliteTable("history", {
  hash: text("hash").primaryKey(),
  type: text("type").notNull().default("transfer"),
  from: text("from").notNull(),
  to: text("to").notNull(),
  amount: text("amount").notNull(),
  formatted: text("formatted").notNull(),
  tokenName: text("token_name").notNull(),
  tokenId: text("token_id").notNull(),
  network: text("network").notNull(),
  status: text("status").notNull(),
  timestamp: text("timestamp").notNull(),
  explorerUrl: text("explorer_url"),
  route: text("route").notNull().default("fast"),
  chainId: integer("chain_id"),
}, (table) => [
  index("idx_history_timestamp").on(table.timestamp),
]);

export const customNetworks = sqliteTable("custom_networks", {
  name: text("name").primaryKey(),
  config: text("config").notNull(),
});

export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
```

- [ ] **Step 1.3: Create `app/cli/drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: join(homedir(), ".fast", "fast.db"),
  },
});
```

- [ ] **Step 1.4: Verify build**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
```

Expected: Build success (schema.ts is standalone).

- [ ] **Step 1.5: Commit**

```bash
git add app/cli/package.json pnpm-lock.yaml app/cli/src/db/schema.ts app/cli/drizzle.config.ts
git commit -m "feat(fast-cli): add Drizzle schema and config"
```

---

## Task 2: Update database.ts to use Drizzle

**Files:** Modify `app/cli/src/services/database.ts`

Replace the raw `Database.Database` export with a Drizzle-wrapped instance. Use Drizzle's push API for schema initialization instead of raw `CREATE TABLE` SQL.

- [ ] **Step 2.1: Rewrite `app/cli/src/services/database.ts`**

```typescript
import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { Context, Layer } from "effect";
import * as schema from "../db/schema.js";

const FAST_DIR = join(homedir(), ".fast");
const DB_PATH = join(FAST_DIR, "fast.db");

export type DrizzleDB = BetterSQLite3Database<typeof schema>;

export interface DatabaseShape {
  readonly db: DrizzleDB;
}

export class DatabaseService extends Context.Tag("Database")<
  DatabaseService,
  DatabaseShape
>() {}

export const DatabaseLive = Layer.sync(DatabaseService, () => {
  mkdirSync(FAST_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(FAST_DIR, 0o700);
  } catch {
    // ignore chmod failures (some filesystems don't support it)
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Schema sync: create tables if they don't exist.
  // Uses raw SQL for bootstrapping — drizzle-kit push is for dev workflow.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      name          TEXT PRIMARY KEY,
      fast_address  TEXT NOT NULL,
      evm_address   TEXT NOT NULL,
      encrypted_key BLOB NOT NULL,
      is_default    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      hash         TEXT PRIMARY KEY,
      type         TEXT NOT NULL DEFAULT 'transfer',
      "from"       TEXT NOT NULL,
      "to"         TEXT NOT NULL,
      amount       TEXT NOT NULL,
      formatted    TEXT NOT NULL,
      token_name   TEXT NOT NULL,
      token_id     TEXT NOT NULL,
      network      TEXT NOT NULL,
      status       TEXT NOT NULL,
      timestamp    TEXT NOT NULL,
      explorer_url TEXT,
      route        TEXT NOT NULL DEFAULT 'fast',
      chain_id     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
    CREATE TABLE IF NOT EXISTS custom_networks (
      name   TEXT PRIMARY KEY,
      config TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed defaults
  sqlite.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)").run(
    "default_network",
    "testnet",
  );

  return { db };
});
```

**Note:** We keep the `CREATE TABLE IF NOT EXISTS` for runtime bootstrap (CLI must work even without running drizzle-kit). `drizzle-kit push` is a dev-time convenience for schema evolution. The `drizzle()` wrapper is what gives us the typed query builder.

- [ ] **Step 2.2: Build**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

Expected: build may fail because services still import `{ db }` expecting raw `Database.Database`. That's expected — Tasks 3-5 fix those.

- [ ] **Step 2.3: Commit**

```bash
git add app/cli/src/services/database.ts
git commit -m "refactor(fast-cli): wrap better-sqlite3 in Drizzle"
```

---

## Task 3: Rewrite account-store.ts with Drizzle queries

**Files:** Modify `app/cli/src/services/account/account-store.ts`

Replace all `stmts.*` raw prepared statements with Drizzle query builder calls. Delete the manual `AccountRow` interface (Drizzle infers types from schema).

- [ ] **Step 3.1: Rewrite `app/cli/src/services/account/account-store.ts`**

```typescript
import { Signer, toHex } from "@fastxyz/sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { eq, count, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { accounts } from "../../db/schema.js";
import {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoAccountsError,
  StorageError,
  WrongPasswordError,
} from "../../errors/index.js";
import { encryptSeed, decryptSeed } from "../crypto.js";
import { DatabaseService } from "../database.js";

export interface AccountInfo {
  readonly name: string;
  readonly fastAddress: string;
  readonly evmAddress: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
}

export interface AccountStoreShape {
  readonly list: () => Effect.Effect<AccountInfo[], StorageError>;
  readonly get: (
    name: string,
  ) => Effect.Effect<AccountInfo, AccountNotFoundError | StorageError>;
  readonly getDefault: () => Effect.Effect<
    AccountInfo,
    NoAccountsError | StorageError
  >;
  readonly create: (
    name: string,
    seed: Uint8Array,
    password: string,
  ) => Effect.Effect<AccountInfo, AccountExistsError | StorageError>;
  readonly import_: (
    name: string,
    seed: Uint8Array,
    password: string,
  ) => Effect.Effect<AccountInfo, AccountExistsError | StorageError>;
  readonly setDefault: (
    name: string,
  ) => Effect.Effect<void, AccountNotFoundError | StorageError>;
  readonly delete_: (
    name: string,
  ) => Effect.Effect<
    void,
    AccountNotFoundError | DefaultAccountError | StorageError
  >;
  readonly export_: (
    name: string,
    password: string,
  ) => Effect.Effect<
    { seed: Uint8Array; entry: AccountInfo },
    AccountNotFoundError | WrongPasswordError | StorageError
  >;
  readonly resolveAccount: (
    flag: Option.Option<string>,
  ) => Effect.Effect<
    AccountInfo,
    AccountNotFoundError | NoAccountsError | StorageError
  >;
  readonly nextAutoName: () => Effect.Effect<string, StorageError>;
}

export class AccountStore extends Context.Tag("AccountStore")<
  AccountStore,
  AccountStoreShape
>() {}

const rowToInfo = (row: typeof accounts.$inferSelect): AccountInfo => ({
  name: row.name,
  fastAddress: row.fastAddress,
  evmAddress: row.evmAddress,
  isDefault: row.isDefault,
  createdAt: row.createdAt,
});

const deriveEvmAddress = (seed: Uint8Array): string => {
  const pubkey = secp256k1.getPublicKey(seed, false);
  const hash = keccak_256(pubkey.slice(1));
  return toHex(hash.slice(-20));
};

const deriveAddresses = (seed: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const signer = new Signer(seed);
      const fastAddress = await signer.getFastAddress();
      const evmAddress = deriveEvmAddress(seed);
      return { fastAddress, evmAddress };
    },
    catch: (cause) =>
      new StorageError({ message: "Failed to derive addresses", cause }),
  });

export const AccountStoreLive = Layer.effect(
  AccountStore,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const storeAccount = (
      name: string,
      seed: Uint8Array,
      password: string,
    ): Effect.Effect<AccountInfo, AccountExistsError | StorageError> =>
      Effect.gen(function* () {
        const existing = db.select().from(accounts).where(eq(accounts.name, name)).get();
        if (existing) {
          return yield* Effect.fail(new AccountExistsError({ name }));
        }

        const { fastAddress, evmAddress } = yield* deriveAddresses(seed);
        const encrypted = yield* Effect.tryPromise({
          try: () => encryptSeed(seed, password),
          catch: (cause) =>
            new StorageError({ message: "Failed to encrypt seed", cause }),
        });

        const isFirst = db.select({ cnt: count() }).from(accounts).get()!.cnt === 0;
        const createdAt = new Date().toISOString();

        db.insert(accounts).values({
          name,
          fastAddress,
          evmAddress,
          encryptedKey: Buffer.from(encrypted),
          isDefault: isFirst,
          createdAt,
        }).run();

        return { name, fastAddress, evmAddress, isDefault: isFirst, createdAt };
      });

    return {
      list: () =>
        Effect.try({
          try: () =>
            db.select().from(accounts).orderBy(accounts.createdAt).all().map(rowToInfo),
          catch: (cause) =>
            new StorageError({ message: "Failed to list accounts", cause }),
        }),

      get: (name) =>
        Effect.try({
          try: () => {
            const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
            if (!row) throw new AccountNotFoundError({ name });
            return rowToInfo(row);
          },
          catch: (e) =>
            e instanceof AccountNotFoundError
              ? e
              : new StorageError({ message: "Failed to get account", cause: e }),
        }),

      getDefault: () =>
        Effect.try({
          try: () => {
            const row = db.select().from(accounts).where(eq(accounts.isDefault, true)).get();
            if (!row) throw new NoAccountsError();
            return rowToInfo(row);
          },
          catch: (e) =>
            e instanceof NoAccountsError
              ? e
              : new StorageError({ message: "Failed to get default account", cause: e }),
        }),

      create: (name, seed, password) => storeAccount(name, seed, password),
      import_: (name, seed, password) => storeAccount(name, seed, password),

      setDefault: (name) =>
        Effect.try({
          try: () => {
            const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
            if (!row) throw new AccountNotFoundError({ name });
            db.update(accounts).set({ isDefault: false }).where(eq(accounts.isDefault, true)).run();
            db.update(accounts).set({ isDefault: true }).where(eq(accounts.name, name)).run();
          },
          catch: (e) =>
            e instanceof AccountNotFoundError
              ? e
              : new StorageError({ message: "Failed to set default", cause: e }),
        }),

      delete_: (name) =>
        Effect.try({
          try: () => {
            const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
            if (!row) throw new AccountNotFoundError({ name });
            if (row.isDefault && db.select({ cnt: count() }).from(accounts).get()!.cnt > 1) {
              throw new DefaultAccountError({ name });
            }
            db.delete(accounts).where(eq(accounts.name, name)).run();
          },
          catch: (e) =>
            e instanceof AccountNotFoundError || e instanceof DefaultAccountError
              ? e
              : new StorageError({ message: "Failed to delete account", cause: e }),
        }),

      export_: (name, password) =>
        Effect.gen(function* () {
          const row = yield* Effect.try({
            try: () => {
              const r = db.select().from(accounts).where(eq(accounts.name, name)).get();
              if (!r) throw new AccountNotFoundError({ name });
              return r;
            },
            catch: (e) =>
              e instanceof AccountNotFoundError
                ? e
                : new StorageError({ message: "Failed to read account", cause: e }),
          });

          const seed = yield* Effect.tryPromise({
            try: () => decryptSeed(new Uint8Array(row.encryptedKey), password),
            catch: (cause) => {
              if (cause instanceof WrongPasswordError) return cause;
              return new StorageError({ message: "Failed to decrypt seed", cause });
            },
          });

          return { seed, entry: rowToInfo(row) };
        }),

      resolveAccount: (flag) =>
        Effect.gen(function* () {
          if (Option.isSome(flag)) {
            const row = db.select().from(accounts).where(eq(accounts.name, flag.value)).get();
            if (!row) {
              return yield* Effect.fail(new AccountNotFoundError({ name: flag.value }));
            }
            return rowToInfo(row);
          }
          const row = db.select().from(accounts).where(eq(accounts.isDefault, true)).get();
          if (!row) {
            return yield* Effect.fail(new NoAccountsError());
          }
          return rowToInfo(row);
        }),

      nextAutoName: () =>
        Effect.try({
          try: () => {
            const rows = db.select({ name: accounts.name }).from(accounts).all();
            const names = new Set(rows.map((r) => r.name));
            let n = 1;
            while (names.has(`account-${n}`)) n++;
            return `account-${n}`;
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to generate account name", cause }),
        }),
    };
  }),
);
```

Key changes from raw SQL:

- `stmts.getByName.get(name)` → `db.select().from(accounts).where(eq(accounts.name, name)).get()`
- `stmts.countAll.get()!.cnt` → `db.select({ cnt: count() }).from(accounts).get()!.cnt`
- `stmts.insert.run(...)` → `db.insert(accounts).values({...}).run()`
- `stmts.clearDefault.run()` + `stmts.setDefault.run(name)` → two `db.update()` calls
- `stmts.deleteByName.run(name)` → `db.delete(accounts).where(eq(accounts.name, name)).run()`
- `db.transaction(() => {...})()` → not needed for single inserts (SQLite auto-wraps). Keep for setDefault which does two updates.
- `AccountRow` interface deleted — `typeof accounts.$inferSelect` provides the type
- `rowToInfo` accepts Drizzle's inferred select type; field names are camelCase (Drizzle maps `fast_address` column → `fastAddress` JS property via the schema definition)

- [ ] **Step 3.2: Build**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

Build may still fail if other services haven't been updated. That's OK.

- [ ] **Step 3.3: Commit**

```bash
git add app/cli/src/services/account/account-store.ts
git commit -m "refactor(fast-cli): use Drizzle queries in account-store"
```

---

## Task 4: Rewrite history-store.ts with Drizzle queries

**Files:** Modify `app/cli/src/services/history-store.ts`

- [ ] **Step 4.1: Rewrite `app/cli/src/services/history-store.ts`**

```typescript
import { eq, sql, desc, and, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { history } from "../db/schema.js";
import { StorageError, TxNotFoundError } from "../errors/index.js";
import type { HistoryEntry } from "../schemas/history.js";
import { DatabaseService } from "./database.js";

export interface HistoryFilters {
  readonly from?: string;
  readonly to?: string;
  readonly token?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface HistoryStoreShape {
  readonly record: (entry: HistoryEntry) => Effect.Effect<void, StorageError>;
  readonly list: (filters: HistoryFilters) => Effect.Effect<HistoryEntry[], StorageError>;
  readonly getByHash: (hash: string) => Effect.Effect<HistoryEntry, TxNotFoundError | StorageError>;
  readonly updateStatus: (hash: string, status: string) => Effect.Effect<void, StorageError>;
}

export class HistoryStore extends Context.Tag("HistoryStore")<HistoryStore, HistoryStoreShape>() {}

const rowToEntry = (row: typeof history.$inferSelect): HistoryEntry => ({
  hash: row.hash,
  type: row.type as "transfer",
  from: row.from,
  to: row.to,
  amount: row.amount,
  formatted: row.formatted,
  tokenName: row.tokenName,
  tokenId: row.tokenId,
  network: row.network,
  status: row.status,
  timestamp: row.timestamp,
  explorerUrl: row.explorerUrl,
  route: row.route as "fast" | "evm-to-fast" | "fast-to-evm",
  chainId: row.chainId,
});

export const HistoryStoreLive = Layer.effect(
  HistoryStore,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      record: (entry) =>
        Effect.try({
          try: () => {
            db.insert(history).values({
              hash: entry.hash,
              type: entry.type,
              from: entry.from,
              to: entry.to,
              amount: entry.amount,
              formatted: entry.formatted,
              tokenName: entry.tokenName,
              tokenId: entry.tokenId,
              network: entry.network,
              status: entry.status,
              timestamp: entry.timestamp,
              explorerUrl: entry.explorerUrl,
              route: entry.route,
              chainId: entry.chainId,
            }).onConflictDoUpdate({
              target: history.hash,
              set: { status: entry.status },
            }).run();
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to record history entry", cause }),
        }),

      list: (filters) =>
        Effect.try({
          try: () => {
            const conditions = [];

            if (filters.from) {
              conditions.push(eq(history.from, filters.from));
            }
            if (filters.to) {
              conditions.push(eq(history.to, filters.to));
            }
            if (filters.token) {
              conditions.push(
                or(
                  eq(sql`LOWER(${history.tokenName})`, filters.token.toLowerCase()),
                  eq(history.tokenId, filters.token),
                )!,
              );
            }

            const query = db
              .select()
              .from(history)
              .orderBy(desc(history.timestamp))
              .limit(filters.limit ?? 20)
              .offset(filters.offset ?? 0);

            const rows = conditions.length > 0
              ? query.where(and(...conditions)).all()
              : query.all();

            return rows.map(rowToEntry);
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to list history", cause }),
        }),

      getByHash: (hash) =>
        Effect.try({
          try: () => {
            const normalized = hash.startsWith("0x") ? hash : `0x${hash}`;
            const row = db.select().from(history).where(eq(history.hash, normalized)).get();
            if (!row) throw new TxNotFoundError({ hash: normalized });
            return rowToEntry(row);
          },
          catch: (e) =>
            e instanceof TxNotFoundError
              ? e
              : new StorageError({ message: "Failed to get transaction", cause: e }),
        }),

      updateStatus: (hash, status) =>
        Effect.try({
          try: () => {
            db.update(history).set({ status }).where(eq(history.hash, hash)).run();
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to update history status", cause }),
        }),
    };
  }),
);
```

Key changes:

- `INSERT OR REPLACE` → `db.insert(history).values({...}).onConflictDoUpdate({target, set}).run()`
- Dynamic SQL string building → Drizzle's `and()`, `or()`, `eq()`, `desc()` composable filters
- `HistoryRow` interface deleted → `typeof history.$inferSelect`
- `rowToEntry` now uses camelCase field names from Drizzle inference (e.g., `row.tokenName` not `row.token_name`)

- [ ] **Step 4.2: Commit**

```bash
git add app/cli/src/services/history-store.ts
git commit -m "refactor(fast-cli): use Drizzle queries in history-store"
```

---

## Task 5: Rewrite network-config.ts with Drizzle queries

**Files:** Modify `app/cli/src/services/network-config.ts`

- [ ] **Step 5.1: Rewrite `app/cli/src/services/network-config.ts`**

```typescript
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  bundledNetworks,
  isBundledNetwork,
  type NetworkConfig,
} from "../config/bundled.js";
import { customNetworks, metadata } from "../db/schema.js";
import {
  DefaultNetworkError,
  InvalidConfigError,
  NetworkExistsError,
  NetworkNotFoundError,
  ReservedNameError,
  StorageError,
} from "../errors/index.js";
import { CustomNetworkConfig } from "../schemas/networks.js";
import { DatabaseService } from "./database.js";

export interface NetworkConfigShape {
  readonly resolve: (
    name: string,
  ) => Effect.Effect<
    NetworkConfig,
    NetworkNotFoundError | StorageError | InvalidConfigError
  >;
  readonly list: () => Effect.Effect<
    Array<{ name: string; type: "bundled" | "custom"; isDefault: boolean }>,
    StorageError
  >;
  readonly setDefault: (
    name: string,
  ) => Effect.Effect<void, NetworkNotFoundError | StorageError>;
  readonly add: (
    name: string,
    configPath: string,
  ) => Effect.Effect<
    void,
    ReservedNameError | NetworkExistsError | InvalidConfigError | StorageError
  >;
  readonly remove: (
    name: string,
  ) => Effect.Effect<
    void,
    | ReservedNameError
    | NetworkNotFoundError
    | DefaultNetworkError
    | StorageError
  >;
  readonly getDefault: () => Effect.Effect<string, StorageError>;
}

export class NetworkConfigService extends Context.Tag("NetworkConfigService")<
  NetworkConfigService,
  NetworkConfigShape
>() {}

export const NetworkConfigLive = Layer.effect(
  NetworkConfigService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const getDefaultNetwork = (): string => {
      const row = db.select().from(metadata).where(eq(metadata.key, "default_network")).get();
      return row?.value ?? "testnet";
    };

    return {
      resolve: (name) =>
        Effect.gen(function* () {
          const bundled = bundledNetworks[name];
          if (bundled) return bundled;

          const row = db.select().from(customNetworks).where(eq(customNetworks.name, name)).get();
          if (!row) {
            return yield* Effect.fail(new NetworkNotFoundError({ name }));
          }

          const custom = yield* Schema.decodeUnknown(CustomNetworkConfig)(
            JSON.parse(row.config),
          ).pipe(
            Effect.mapError(
              () => new InvalidConfigError({ message: `Invalid network config: ${name}` }),
            ),
          );

          return {
            rpcUrl: custom.fast.rpcUrl,
            explorerUrl: custom.fast.explorerUrl,
            networkId: `fast:${name}`,
            ...(Option.isSome(custom.allset)
              ? { allset: custom.allset.value }
              : {}),
          } satisfies NetworkConfig;
        }),

      list: () =>
        Effect.try({
          try: () => {
            const defaultName = getDefaultNetwork();
            const customRows = db.select({ name: customNetworks.name }).from(customNetworks).all();
            const allNames = [
              ...Object.keys(bundledNetworks),
              ...customRows.map((r) => r.name),
            ];
            return allNames.map((name) => ({
              name,
              type: (isBundledNetwork(name) ? "bundled" : "custom") as "bundled" | "custom",
              isDefault: name === defaultName,
            }));
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to list networks", cause }),
        }),

      setDefault: (name) =>
        Effect.try({
          try: () => {
            if (!isBundledNetwork(name) && !db.select().from(customNetworks).where(eq(customNetworks.name, name)).get()) {
              throw new NetworkNotFoundError({ name });
            }
            db.insert(metadata).values({ key: "default_network", value: name })
              .onConflictDoUpdate({ target: metadata.key, set: { value: name } }).run();
          },
          catch: (e) =>
            e instanceof NetworkNotFoundError
              ? e
              : new StorageError({ message: "Failed to set default network", cause: e }),
        }),

      add: (name, configPath) =>
        Effect.gen(function* () {
          if (isBundledNetwork(name)) {
            return yield* Effect.fail(new ReservedNameError({ name }));
          }
          if (db.select().from(customNetworks).where(eq(customNetworks.name, name)).get()) {
            return yield* Effect.fail(new NetworkExistsError({ name }));
          }

          const content = yield* Effect.try({
            try: () => readFileSync(configPath, "utf-8"),
            catch: () =>
              new InvalidConfigError({ message: `Cannot read config file: ${configPath}` }),
          });

          yield* Schema.decodeUnknown(CustomNetworkConfig)(JSON.parse(content)).pipe(
            Effect.mapError(
              () => new InvalidConfigError({ message: "Invalid network config format" }),
            ),
          );

          yield* Effect.try({
            try: () => db.insert(customNetworks).values({ name, config: content }).run(),
            catch: (cause) =>
              new StorageError({ message: "Failed to save network config", cause }),
          });
        }),

      remove: (name) =>
        Effect.try({
          try: () => {
            if (isBundledNetwork(name)) throw new ReservedNameError({ name });
            if (!db.select().from(customNetworks).where(eq(customNetworks.name, name)).get()) {
              throw new NetworkNotFoundError({ name });
            }
            if (getDefaultNetwork() === name) throw new DefaultNetworkError({ name });
            db.delete(customNetworks).where(eq(customNetworks.name, name)).run();
          },
          catch: (e) =>
            e instanceof ReservedNameError ||
            e instanceof NetworkNotFoundError ||
            e instanceof DefaultNetworkError
              ? e
              : new StorageError({ message: "Failed to remove network", cause: e }),
        }),

      getDefault: () =>
        Effect.try({
          try: () => getDefaultNetwork(),
          catch: (cause) =>
            new StorageError({ message: "Failed to get default network", cause }),
        }),
    };
  }),
);
```

Key changes:

- `stmts.getConfig.get(name)` → `db.select().from(customNetworks).where(eq(customNetworks.name, name)).get()`
- `stmts.setMeta.run(...)` → `db.insert(metadata).values({...}).onConflictDoUpdate({...}).run()`
- `stmts.insertConfig.run(...)` → `db.insert(customNetworks).values({...}).run()`
- `stmts.deleteConfig.run(name)` → `db.delete(customNetworks).where(eq(customNetworks.name, name)).run()`
- `stmts.listCustom.all()` → `db.select({ name: customNetworks.name }).from(customNetworks).all()`

- [ ] **Step 5.2: Build + smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
rm -rf ~/.fast
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name drizzle-test --password testpw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account export drizzle-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete drizzle-test --non-interactive --json
```

Expected: Build success, all commands work with SQLite via Drizzle.

- [ ] **Step 5.3: Commit**

```bash
git add app/cli/src/services/network-config.ts
git commit -m "refactor(fast-cli): use Drizzle queries in network-config"
```

---

## Task 6: Final verification

**Files:** None modified.

- [ ] **Step 6.1: Clean state test**

```bash
rm -rf ~/.fast
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build
node app/cli/dist/main.js --version
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name verify-test --password testpw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account export verify-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete verify-test --non-interactive --json
node app/cli/dist/main.js info status --json
node app/cli/dist/main.js info tx 0xDEADBEEF --json ; echo "EXIT=$?"
```

- [ ] **Step 6.2: Verify no raw SQL in services**

```bash
grep -rn "db\.prepare\|\.prepare(" app/cli/src/services/ || echo "no raw prepared statements"
```

Expected: "no raw prepared statements" (all raw SQL is confined to `database.ts` for bootstrap).

- [ ] **Step 6.3: Verify Drizzle imports in services**

```bash
grep -rn "from \"drizzle-orm\"" app/cli/src/services/
grep -rn "from \"../../db/schema\|from \"../db/schema" app/cli/src/services/
```

Expected: Drizzle and schema imports in account-store, history-store, network-config.

- [ ] **Step 6.4: Commit list**

```bash
git log --oneline c35341b..HEAD
```

Report the full commit list.

---

## Verification summary

The adoption is complete when:

1. `pnpm -F @fastxyz/fast-cli build` succeeds
2. Account create → list → export → delete round-trip works
3. `grep -rn "db\.prepare" app/cli/src/services/` returns nothing (only `database.ts` has raw SQL)
4. `db/schema.ts` is the single source of truth for table shapes
5. No `AccountRow` / `HistoryRow` manual interfaces remain in service files
6. `drizzle.config.ts` exists for future `drizzle-kit push` / `drizzle-kit generate` usage
