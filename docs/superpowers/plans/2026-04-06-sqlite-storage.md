<!-- markdownlint-disable MD013 -->
# SQLite Storage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat JSON file storage + manual V3 keystore with a single SQLite database and an internal crypto module.

**Architecture:** Three new modules: `crypto.ts` (encrypt/decrypt, ~40 lines), `database.ts` (SQLite Effect service), and rewritten `account-store.ts` / `history-store.ts` / `network-config.ts` using SQL queries. Public service interfaces stay identical — command files don't change.

**Tech Stack:** TypeScript, Effect 3.x, better-sqlite3, @noble/ciphers + @noble/hashes (existing), citty.

**Spec:** [docs/superpowers/specs/2026-04-06-sqlite-storage-design.md](../specs/2026-04-06-sqlite-storage-design.md)

---

## File structure

**Created:**

- `app/cli/src/services/crypto.ts` — `encryptSeed` / `decryptSeed` functions
- `app/cli/src/services/database.ts` — `Database` Effect service (owns better-sqlite3 connection)

**Rewritten:**

- `app/cli/src/services/account/account-store.ts` — SQL queries replace JSON I/O
- `app/cli/src/services/history-store.ts` — SQL queries replace JSON I/O
- `app/cli/src/services/network-config.ts` — SQL queries replace JSON I/O
- `app/cli/src/layers.ts` — add Database, remove KeystoreV3, remove FileSystem deps

**Simplified:**

- `app/cli/src/schemas/history.ts` — `HistoryEntry` becomes a plain interface (drop `Schema.Class`)
- `app/cli/src/schemas/networks.ts` — keep `CustomNetworkConfig` schema, drop `NetworksFile`

**Deleted:**

- `app/cli/src/services/keystore-v3.ts`
- `app/cli/src/schemas/keyfile.ts`
- `app/cli/src/schemas/accounts.ts`

**Unchanged:** all command files, `cli-config.ts`, `fast-rpc.ts`, `output.ts`, `password-service.ts`, `token-resolver.ts`, `errors/`, `config/bundled.ts`.

---

## Task 1: Add dependencies, remove old ones

**Files:** Modify `app/cli/package.json`

- [ ] **Step 1.1: Install better-sqlite3, remove proper-lockfile**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli add better-sqlite3
pnpm -F @fastxyz/fast-cli add -D @types/better-sqlite3
pnpm -F @fastxyz/fast-cli remove proper-lockfile @types/proper-lockfile
```

- [ ] **Step 1.2: Verify package.json**

```bash
grep -E "better-sqlite3|proper-lockfile" app/cli/package.json
```

Expected: `better-sqlite3` in dependencies, `@types/better-sqlite3` in devDependencies, no `proper-lockfile`.

- [ ] **Step 1.3: Commit**

```bash
git add app/cli/package.json pnpm-lock.yaml
git commit -m "chore(fast-cli): add better-sqlite3, remove proper-lockfile"
```

---

## Task 2: Create `crypto.ts` — encryption module

**Files:** Create `app/cli/src/services/crypto.ts`

This extracts the encrypt/decrypt logic from `keystore-v3.ts` into two standalone async functions with no Effect dependency. The blob format is a versioned JSON object stored as `Uint8Array`.

- [ ] **Step 2.1: Create `app/cli/src/services/crypto.ts`**

```typescript
import { timingSafeEqual } from "node:crypto";
import { ctr } from "@noble/ciphers/aes";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { fromHex, toHex } from "@fastxyz/fast-sdk";
import { WrongPasswordError } from "../errors/index.js";

const SCRYPT_N = 262144;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DKLEN = 32;

interface EncryptedBlob {
  v: 1;
  salt: string;
  iv: string;
  mac: string;
  ct: string;
  kdf: { n: number; r: number; p: number };
}

const computeMac = (derivedKey: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
  keccak_256(new Uint8Array([...derivedKey.slice(16, 32), ...ciphertext]));

/**
 * Encrypt a seed with a password. Returns an opaque blob (JSON bytes)
 * that can only be decrypted with the same password.
 */
export const encryptSeed = async (seed: Uint8Array, password: string): Promise<Uint8Array> => {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derivedKey = await scryptAsync(
    new TextEncoder().encode(password),
    salt,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: DKLEN },
  );
  const cipher = ctr(derivedKey.slice(0, 16), iv);
  const ciphertext = cipher.encrypt(seed);
  const mac = computeMac(derivedKey, ciphertext);

  const blob: EncryptedBlob = {
    v: 1,
    salt: toHex(salt),
    iv: toHex(iv),
    mac: toHex(mac),
    ct: toHex(ciphertext),
    kdf: { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
  };
  return new TextEncoder().encode(JSON.stringify(blob));
};

/**
 * Decrypt a seed from an encrypted blob. Throws WrongPasswordError if
 * the password is incorrect (MAC mismatch).
 */
export const decryptSeed = async (blob: Uint8Array, password: string): Promise<Uint8Array> => {
  const parsed: EncryptedBlob = JSON.parse(new TextDecoder().decode(blob));
  const salt = fromHex(parsed.salt);
  const iv = fromHex(parsed.iv);
  const ciphertext = fromHex(parsed.ct);
  const storedMac = fromHex(parsed.mac);

  const derivedKey = await scryptAsync(
    new TextEncoder().encode(password),
    salt,
    { N: parsed.kdf.n, r: parsed.kdf.r, p: parsed.kdf.p, dkLen: DKLEN },
  );

  const computedMac = computeMac(derivedKey, ciphertext);
  if (!timingSafeEqual(computedMac, storedMac)) {
    throw new WrongPasswordError();
  }

  const cipher = ctr(derivedKey.slice(0, 16), iv);
  return cipher.decrypt(ciphertext);
};
```

- [ ] **Step 2.2: Build**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
```

Expected: Build success (crypto.ts is standalone, no consumers yet).

- [ ] **Step 2.3: Commit**

```bash
git add app/cli/src/services/crypto.ts
git commit -m "feat(fast-cli): add crypto module for seed encrypt/decrypt"
```

---

## Task 3: Create `database.ts` — SQLite Effect service

**Files:** Create `app/cli/src/services/database.ts`

- [ ] **Step 3.1: Create `app/cli/src/services/database.ts`**

```typescript
import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Context, Effect, Layer } from "effect";

const FAST_DIR = join(homedir(), ".fast");
const DB_PATH = join(FAST_DIR, "fast.db");

export interface DatabaseShape {
  readonly db: Database.Database;
}

export class DatabaseService extends Context.Tag("Database")<
  DatabaseService,
  DatabaseShape
>() {}

const initSchema = (db: Database.Database): void => {
  db.exec(`
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
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)").run(
    "default_network",
    "testnet",
  );
};

export const DatabaseLive = Layer.sync(DatabaseService, () => {
  mkdirSync(FAST_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(FAST_DIR, 0o700);
  } catch {
    // ignore chmod failures (some filesystems don't support it)
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return { db };
});
```

- [ ] **Step 3.2: Build**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
```

Expected: Build success.

- [ ] **Step 3.3: Commit**

```bash
git add app/cli/src/services/database.ts
git commit -m "feat(fast-cli): add SQLite database service"
```

---

## Task 4: Rewrite `account-store.ts` to use SQLite

**Files:** Rewrite `app/cli/src/services/account/account-store.ts`

The public `AccountStoreShape` interface stays identical. The internal implementation switches from JSON files + KeystoreV3 to SQL queries + `crypto.ts`.

- [ ] **Step 4.1: Rewrite `app/cli/src/services/account/account-store.ts`**

```typescript
import { Signer, toHex } from "@fastxyz/fast-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { Context, Effect, Layer, Option } from "effect";
import {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoAccountsError,
  StorageError,
  type WrongPasswordError,
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

interface AccountRow {
  name: string;
  fast_address: string;
  evm_address: string;
  encrypted_key: Buffer;
  is_default: number;
  created_at: string;
}

const rowToInfo = (row: AccountRow): AccountInfo => ({
  name: row.name,
  fastAddress: row.fast_address,
  evmAddress: row.evm_address,
  isDefault: row.is_default === 1,
  createdAt: row.created_at,
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

    const stmts = {
      listAll: db.prepare<[], AccountRow>("SELECT * FROM accounts ORDER BY created_at"),
      getByName: db.prepare<[string], AccountRow>("SELECT * FROM accounts WHERE name = ?"),
      getDefault: db.prepare<[], AccountRow>("SELECT * FROM accounts WHERE is_default = 1"),
      countAll: db.prepare<[], { cnt: number }>("SELECT COUNT(*) as cnt FROM accounts"),
      insert: db.prepare(
        "INSERT INTO accounts (name, fast_address, evm_address, encrypted_key, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ),
      clearDefault: db.prepare("UPDATE accounts SET is_default = 0 WHERE is_default = 1"),
      setDefault: db.prepare("UPDATE accounts SET is_default = 1 WHERE name = ?"),
      deleteByName: db.prepare("DELETE FROM accounts WHERE name = ?"),
      allNames: db.prepare<[], { name: string }>("SELECT name FROM accounts"),
    };

    const storeAccount = (
      name: string,
      seed: Uint8Array,
      password: string,
    ): Effect.Effect<AccountInfo, AccountExistsError | StorageError> =>
      Effect.gen(function* () {
        const existing = stmts.getByName.get(name);
        if (existing) {
          return yield* Effect.fail(new AccountExistsError({ name }));
        }

        const { fastAddress, evmAddress } = yield* deriveAddresses(seed);
        const encrypted = yield* Effect.tryPromise({
          try: () => encryptSeed(seed, password),
          catch: (cause) =>
            new StorageError({ message: "Failed to encrypt seed", cause }),
        });

        const isFirst = stmts.countAll.get()!.cnt === 0;
        const createdAt = new Date().toISOString();

        db.transaction(() => {
          stmts.insert.run(
            name,
            fastAddress,
            evmAddress,
            Buffer.from(encrypted),
            isFirst ? 1 : 0,
            createdAt,
          );
        })();

        return {
          name,
          fastAddress,
          evmAddress,
          isDefault: isFirst,
          createdAt,
        };
      });

    return {
      list: () =>
        Effect.try({
          try: () => stmts.listAll.all().map(rowToInfo),
          catch: (cause) =>
            new StorageError({ message: "Failed to list accounts", cause }),
        }),

      get: (name) =>
        Effect.try({
          try: () => {
            const row = stmts.getByName.get(name);
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
            const row = stmts.getDefault.get();
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
            const row = stmts.getByName.get(name);
            if (!row) throw new AccountNotFoundError({ name });
            db.transaction(() => {
              stmts.clearDefault.run();
              stmts.setDefault.run(name);
            })();
          },
          catch: (e) =>
            e instanceof AccountNotFoundError
              ? e
              : new StorageError({ message: "Failed to set default", cause: e }),
        }),

      delete_: (name) =>
        Effect.try({
          try: () => {
            const row = stmts.getByName.get(name);
            if (!row) throw new AccountNotFoundError({ name });
            if (row.is_default === 1 && stmts.countAll.get()!.cnt > 1) {
              throw new DefaultAccountError({ name });
            }
            stmts.deleteByName.run(name);
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
              const r = stmts.getByName.get(name);
              if (!r) throw new AccountNotFoundError({ name });
              return r;
            },
            catch: (e) =>
              e instanceof AccountNotFoundError
                ? e
                : new StorageError({ message: "Failed to read account", cause: e }),
          });

          const seed = yield* Effect.tryPromise({
            try: () => decryptSeed(new Uint8Array(row.encrypted_key), password),
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
            const row = stmts.getByName.get(flag.value);
            if (!row) {
              return yield* Effect.fail(
                new AccountNotFoundError({ name: flag.value }),
              );
            }
            return rowToInfo(row);
          }
          const row = stmts.getDefault.get();
          if (!row) {
            return yield* Effect.fail(new NoAccountsError());
          }
          return rowToInfo(row);
        }),

      nextAutoName: () =>
        Effect.try({
          try: () => {
            const names = new Set(stmts.allNames.all().map((r) => r.name));
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

- [ ] **Step 4.2: Build (will fail until layers.ts is updated — that's fine)**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

Note: tsup may succeed (esbuild resolves imports lazily) or fail. Either way, the file compiles in isolation. Full build success happens after Task 7.

- [ ] **Step 4.3: Commit**

```bash
git add app/cli/src/services/account/account-store.ts
git commit -m "refactor(fast-cli): rewrite account-store with SQLite"
```

---

## Task 5: Rewrite `history-store.ts` to use SQLite

**Files:** Rewrite `app/cli/src/services/history-store.ts`

- [ ] **Step 5.1: Simplify `app/cli/src/schemas/history.ts`**

Replace the Effect Schema class with a plain interface + constructor helper:

```typescript
export interface HistoryEntry {
  readonly hash: string;
  readonly type: "transfer";
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly formatted: string;
  readonly tokenName: string;
  readonly tokenId: string;
  readonly network: string;
  readonly status: string;
  readonly timestamp: string;
  readonly explorerUrl: string | null;
  readonly route: "fast" | "evm-to-fast" | "fast-to-evm";
  readonly chainId: number | null;
}

export const makeHistoryEntry = (
  fields: Omit<HistoryEntry, "route" | "chainId"> & {
    route?: HistoryEntry["route"];
    chainId?: number | null;
  },
): HistoryEntry => ({
  ...fields,
  route: fields.route ?? "fast",
  chainId: fields.chainId ?? null,
});
```

- [ ] **Step 5.2: Rewrite `app/cli/src/services/history-store.ts`**

```typescript
import { Context, Effect, Layer } from "effect";
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

interface HistoryRow {
  hash: string;
  type: string;
  from: string;
  to: string;
  amount: string;
  formatted: string;
  token_name: string;
  token_id: string;
  network: string;
  status: string;
  timestamp: string;
  explorer_url: string | null;
  route: string;
  chain_id: number | null;
}

const rowToEntry = (row: HistoryRow): HistoryEntry => ({
  hash: row.hash,
  type: row.type as "transfer",
  from: row.from,
  to: row.to,
  amount: row.amount,
  formatted: row.formatted,
  tokenName: row.token_name,
  tokenId: row.token_id,
  network: row.network,
  status: row.status,
  timestamp: row.timestamp,
  explorerUrl: row.explorer_url,
  route: row.route as "fast" | "evm-to-fast" | "fast-to-evm",
  chainId: row.chain_id,
});

export const HistoryStoreLive = Layer.effect(
  HistoryStore,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const stmts = {
      insert: db.prepare(
        `INSERT OR REPLACE INTO history
         (hash, type, "from", "to", amount, formatted, token_name, token_id, network, status, timestamp, explorer_url, route, chain_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      getByHash: db.prepare<[string], HistoryRow>("SELECT * FROM history WHERE hash = ?"),
      updateStatus: db.prepare("UPDATE history SET status = ? WHERE hash = ?"),
    };

    return {
      record: (entry) =>
        Effect.try({
          try: () => {
            stmts.insert.run(
              entry.hash,
              entry.type,
              entry.from,
              entry.to,
              entry.amount,
              entry.formatted,
              entry.tokenName,
              entry.tokenId,
              entry.network,
              entry.status,
              entry.timestamp,
              entry.explorerUrl,
              entry.route,
              entry.chainId,
            );
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to record history entry", cause }),
        }),

      list: (filters) =>
        Effect.try({
          try: () => {
            const conditions: string[] = [];
            const params: unknown[] = [];

            if (filters.from) {
              conditions.push('"from" = ?');
              params.push(filters.from);
            }
            if (filters.to) {
              conditions.push('"to" = ?');
              params.push(filters.to);
            }
            if (filters.token) {
              conditions.push("(LOWER(token_name) = LOWER(?) OR token_id = ?)");
              params.push(filters.token, filters.token);
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const limit = filters.limit ?? 20;
            const offset = filters.offset ?? 0;

            const sql = `SELECT * FROM history ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            return db.prepare(sql).all(...params).map((row) => rowToEntry(row as HistoryRow));
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to list history", cause }),
        }),

      getByHash: (hash) =>
        Effect.try({
          try: () => {
            const normalized = hash.startsWith("0x") ? hash : `0x${hash}`;
            const row = stmts.getByHash.get(normalized);
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
            stmts.updateStatus.run(status, hash);
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to update history status", cause }),
        }),
    };
  }),
);
```

- [ ] **Step 5.3: Commit**

```bash
git add app/cli/src/schemas/history.ts app/cli/src/services/history-store.ts
git commit -m "refactor(fast-cli): rewrite history-store with SQLite"
```

---

## Task 6: Rewrite `network-config.ts` to use SQLite

**Files:** Modify `app/cli/src/services/network-config.ts`, simplify `app/cli/src/schemas/networks.ts`

- [ ] **Step 6.1: Simplify `app/cli/src/schemas/networks.ts`**

Remove `NetworksFile` class (no longer needed). Keep `CustomNetworkConfig` and its sub-schemas:

```typescript
import { Schema } from "effect";

const AllsetChainTokenSchema = Schema.Struct({
  evmAddress: Schema.String,
  fastTokenId: Schema.String,
  decimals: Schema.Number,
});

const AllsetChainSchema = Schema.Struct({
  chainId: Schema.Number,
  bridgeContract: Schema.String,
  fastBridgeAddress: Schema.String,
  relayerUrl: Schema.String,
  evmRpcUrl: Schema.String,
  tokens: Schema.Record({ key: Schema.String, value: AllsetChainTokenSchema }),
});

const AllsetConfigSchema = Schema.Struct({
  crossSignUrl: Schema.String,
  chains: Schema.Record({ key: Schema.String, value: AllsetChainSchema }),
});

export class CustomNetworkConfig extends Schema.Class<CustomNetworkConfig>("CustomNetworkConfig")({
  fast: Schema.Struct({
    rpcUrl: Schema.String,
    explorerUrl: Schema.String,
  }),
  allset: Schema.optionalWith(AllsetConfigSchema, { as: "Option" }),
}) {}
```

- [ ] **Step 6.2: Rewrite `app/cli/src/services/network-config.ts`**

```typescript
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  bundledNetworks,
  isBundledNetwork,
  type NetworkConfig,
} from "../config/bundled.js";
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

    const stmts = {
      getConfig: db.prepare<[string], { config: string }>(
        "SELECT config FROM custom_networks WHERE name = ?",
      ),
      listCustom: db.prepare<[], { name: string }>("SELECT name FROM custom_networks"),
      insertConfig: db.prepare(
        "INSERT INTO custom_networks (name, config) VALUES (?, ?)",
      ),
      deleteConfig: db.prepare("DELETE FROM custom_networks WHERE name = ?"),
      getMeta: db.prepare<[string], { value: string }>(
        "SELECT value FROM metadata WHERE key = ?",
      ),
      setMeta: db.prepare(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
      ),
    };

    const getDefaultNetwork = (): string =>
      stmts.getMeta.get("default_network")?.value ?? "testnet";

    return {
      resolve: (name) =>
        Effect.gen(function* () {
          const bundled = bundledNetworks[name];
          if (bundled) return bundled;

          const row = stmts.getConfig.get(name);
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
            const customNames = stmts.listCustom.all().map((r) => r.name);
            const allNames = [
              ...Object.keys(bundledNetworks),
              ...customNames,
            ];
            return allNames.map((name) => ({
              name,
              type: (isBundledNetwork(name) ? "bundled" : "custom") as
                | "bundled"
                | "custom",
              isDefault: name === defaultName,
            }));
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to list networks", cause }),
        }),

      setDefault: (name) =>
        Effect.try({
          try: () => {
            // Verify network exists (bundled or custom)
            if (!isBundledNetwork(name) && !stmts.getConfig.get(name)) {
              throw new NetworkNotFoundError({ name });
            }
            stmts.setMeta.run("default_network", name);
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
          if (stmts.getConfig.get(name)) {
            return yield* Effect.fail(new NetworkExistsError({ name }));
          }

          const content = yield* Effect.try({
            try: () => {
              const { readFileSync } = require("node:fs") as typeof import("node:fs");
              return readFileSync(configPath, "utf-8");
            },
            catch: () =>
              new InvalidConfigError({
                message: `Cannot read config file: ${configPath}`,
              }),
          });

          yield* Schema.decodeUnknown(CustomNetworkConfig)(
            JSON.parse(content),
          ).pipe(
            Effect.mapError(
              () =>
                new InvalidConfigError({
                  message: "Invalid network config format",
                }),
            ),
          );

          yield* Effect.try({
            try: () => stmts.insertConfig.run(name, content),
            catch: (cause) =>
              new StorageError({ message: "Failed to save network config", cause }),
          });
        }),

      remove: (name) =>
        Effect.try({
          try: () => {
            if (isBundledNetwork(name)) {
              throw new ReservedNameError({ name });
            }
            if (!stmts.getConfig.get(name)) {
              throw new NetworkNotFoundError({ name });
            }
            if (getDefaultNetwork() === name) {
              throw new DefaultNetworkError({ name });
            }
            stmts.deleteConfig.run(name);
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

- [ ] **Step 6.3: Commit**

```bash
git add app/cli/src/schemas/networks.ts app/cli/src/services/network-config.ts
git commit -m "refactor(fast-cli): rewrite network-config with SQLite"
```

---

## Task 7: Update layers + delete old files

**Files:** Modify `app/cli/src/layers.ts`, delete old files

- [ ] **Step 7.1: Rewrite `app/cli/src/layers.ts`**

```typescript
import { Layer, type Option } from "effect";
import { DatabaseLive } from "./services/database.js";
import { AccountStoreLive } from "./services/account/account-store.js";
import { makeConfigLayer } from "./services/cli-config.js";
import { FastRpcLive } from "./services/fast-rpc.js";
import { HistoryStoreLive } from "./services/history-store.js";
import { NetworkConfigLive } from "./services/network-config.js";
import { OutputLive } from "./services/output.js";
import { PasswordLive } from "./services/password.js";

interface ParsedOptions {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export const makeAppLayer = (parsed: ParsedOptions) => {
  const cliConfigLayer = makeConfigLayer({
    json: parsed.json,
    debug: parsed.debug,
    nonInteractive: parsed.nonInteractive || parsed.json,
    network: parsed.network,
    account: parsed.account,
    password: parsed.password,
  });

  // Foundation: database + config
  const foundation = Layer.mergeAll(DatabaseLive, cliConfigLayer);

  // Services that depend only on foundation
  const tier1 = Layer.mergeAll(
    OutputLive,
    PasswordLive,
    NetworkConfigLive,
    HistoryStoreLive,
    AccountStoreLive,
  ).pipe(Layer.provide(foundation));

  // Services that depend on tier1
  const tier2 = Layer.mergeAll(
    FastRpcLive,
  ).pipe(Layer.provide(Layer.merge(foundation, tier1)));

  return Layer.mergeAll(foundation, tier1, tier2);
};
```

Note: `NodeContext.layer` is removed from foundation (no longer needed — we don't use `@effect/platform` FileSystem). `KeystoreV3Live` is removed. `AccountStoreLive` moves from tier2 to tier1 (it no longer depends on KeystoreV3 or FileSystem).

- [ ] **Step 7.2: Delete old files**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
rm app/cli/src/services/keystore-v3.ts
rm app/cli/src/schemas/keyfile.ts
rm app/cli/src/schemas/accounts.ts
```

- [ ] **Step 7.3: Remove stale `@effect/platform` imports if no longer used**

Check if any remaining file imports from `@effect/platform`:

```bash
grep -rn "@effect/platform" app/cli/src/
```

If only `layers.ts` imported it (and it's now removed), check if `@effect/platform` and `@effect/platform-node` can be removed from `package.json`. If other files (e.g., `output.ts`) still use them, leave the dependency.

- [ ] **Step 7.4: Build**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

Expected: `Build success`. This is the moment everything comes together. If it fails, the error will point to a missing import or type mismatch — fix it.

- [ ] **Step 7.5: Smoke-test**

```bash
# Clean up old data
rm -rf ~/.fast

# Test the full lifecycle
node app/cli/dist/main.js --help
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name sqlite-test --password testpw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account export sqlite-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete sqlite-test --non-interactive --json

# Verify the database exists
ls -la ~/.fast/fast.db
```

Expected:

- `--help` works
- `network list` shows testnet + mainnet
- `account create` succeeds, returns addresses
- `account list` shows the created account
- `account export` returns the private key
- `account delete` succeeds
- `~/.fast/fast.db` exists

- [ ] **Step 7.6: Commit**

```bash
git add app/cli/src/layers.ts
git rm app/cli/src/services/keystore-v3.ts app/cli/src/schemas/keyfile.ts app/cli/src/schemas/accounts.ts
git add -A app/cli/
git commit -m "refactor(fast-cli): wire SQLite layer, delete JSON storage"
```

---

## Task 8: Update HistoryEntry usage across commands

**Files:** Modify command files that construct `HistoryEntry`

Since `HistoryEntry` changed from a `Schema.Class` (constructed with `new HistoryEntry({...})`) to a plain interface + `makeHistoryEntry()` factory, all construction sites need updating.

- [ ] **Step 8.1: Find all HistoryEntry construction sites**

```bash
grep -rn "new HistoryEntry" app/cli/src/
```

- [ ] **Step 8.2: Replace each `new HistoryEntry({...})` with `makeHistoryEntry({...})`**

For each match, change:

```typescript
// Before
new HistoryEntry({ hash, type: 'transfer', from, to, ... })

// After
makeHistoryEntry({ hash, type: 'transfer', from, to, ... })
```

Also update imports:

```typescript
// Before
import { HistoryEntry } from '../schemas/history.js';

// After
import { makeHistoryEntry } from '../schemas/history.js';
```

If `HistoryEntry` is used as a TYPE (e.g., in function signatures), keep it as a type import:

```typescript
import type { HistoryEntry } from '../schemas/history.js';
import { makeHistoryEntry } from '../schemas/history.js';
```

- [ ] **Step 8.3: Build + smoke-test**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
```

Expected: Build success.

- [ ] **Step 8.4: Commit**

```bash
git add app/cli/src/
git commit -m "refactor(fast-cli): update HistoryEntry construction to use factory"
```

---

## Task 9: Final verification

**Files:** None modified.

- [ ] **Step 9.1: Clean state test**

```bash
rm -rf ~/.fast
cd /home/yuqing/Documents/Code/fast-sdk && pnpm -F @fastxyz/fast-cli build

# Full lifecycle
node app/cli/dist/main.js --version
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name verify-test --password testpw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account info verify-test --json
node app/cli/dist/main.js account export verify-test --password testpw --non-interactive --json
node app/cli/dist/main.js account set-default verify-test --json
node app/cli/dist/main.js account delete verify-test --non-interactive --json
node app/cli/dist/main.js info status --json
node app/cli/dist/main.js info tx 0xDEADBEEF --json ; echo "EXIT=$?"
```

- [ ] **Step 9.2: Verify no JSON file artifacts**

```bash
ls ~/.fast/
```

Expected: only `fast.db` (and possibly `fast.db-wal`, `fast.db-shm` from WAL mode). NO `accounts.json`, `keys/`, `history.json`, `networks.json`, `networks/`.

- [ ] **Step 9.3: Verify deleted files are gone**

```bash
ls app/cli/src/services/keystore-v3.ts 2>&1
ls app/cli/src/schemas/keyfile.ts 2>&1
ls app/cli/src/schemas/accounts.ts 2>&1
```

Expected: all three return "No such file or directory".

- [ ] **Step 9.4: Verify no proper-lockfile references**

```bash
grep -rn "proper-lockfile\|lockfile" app/cli/src/ app/cli/package.json
```

Expected: zero matches.

- [ ] **Step 9.5: Type-check count**

```bash
npx --no-install tsc --noEmit -p app/cli/tsconfig.json 2>&1 | grep -c "error TS"
```

Report the count. It should be equal to or less than the pre-refactor baseline.

---

## Verification summary

The refactor is complete when:

1. `~/.fast/fast.db` is the only storage artifact (no JSON files)
2. `pnpm -F @fastxyz/fast-cli build` succeeds
3. Account create → list → export → delete round-trip works with `--json`
4. `proper-lockfile` is gone from `package.json` and source
5. `keystore-v3.ts`, `schemas/keyfile.ts`, `schemas/accounts.ts` are deleted
6. All command files are unchanged (same imports, same API calls)
7. Type-check error count ≤ baseline
