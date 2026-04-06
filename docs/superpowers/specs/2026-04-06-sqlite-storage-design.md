<!-- markdownlint-disable MD013 -->
# Storage Layer Refactor: SQLite + Crypto Module

## Goal

Replace the flat JSON file storage (`accounts.json`, `keys/*.json`, `history.json`, `networks.json`) and manual V3 keystore implementation with a single SQLite database (`~/.fast/fast.db`) and an internal crypto module. Reduce code surface, eliminate file-locking complexity, and contain encryption details to a single module.

## Context

The current storage layer uses 4 JSON files and a directory of per-account keyfiles under `~/.fast/`. Each read loads the entire file into memory; each write serializes the full array back. File-level locking is handled by `proper-lockfile`. The keystore-v3 implementation manually wires scrypt + AES-256-CTR + keccak-256 MAC across ~100 lines.

This is pre-v1 software with no deployed users to migrate. The `~/.fast/` directory can be nuked on upgrade.

## Architecture

Three layers replace the current system:

### 1. `crypto.ts` — encryption module

**Location:** `app/cli/src/services/crypto.ts`

Pure module (no Effect service, no Context.Tag). Two async functions:

```typescript
encryptSeed(seed: Uint8Array, password: string): Promise<Uint8Array>
decryptSeed(blob: Uint8Array, password: string): Promise<Uint8Array>
```

`encryptSeed` returns a self-describing JSON blob (serialized to bytes) containing all the crypto parameters. `decryptSeed` parses it, verifies the MAC, and returns the original seed. Throws `WrongPasswordError` on MAC mismatch.

**Internal blob format** (not exposed outside this module):

```json
{
  "v": 1,
  "salt": "<hex>",
  "iv": "<hex>",
  "mac": "<hex>",
  "ct": "<hex>",
  "kdf": { "n": 262144, "r": 8, "p": 1 }
}
```

The `v` field enables future changes to the encryption scheme without breaking existing blobs.

**Dependencies:** `@noble/ciphers` (AES-256-CTR), `@noble/hashes` (scrypt, keccak-256), `node:crypto` (timingSafeEqual) — all already in the project.

### 2. `database.ts` — SQLite service

**Location:** `app/cli/src/services/database.ts`

An Effect service that owns the `better-sqlite3` connection. Responsibilities:

- Opens or creates `~/.fast/fast.db` on first access
- Ensures the `~/.fast/` directory exists with mode `0o700`
- Runs schema creation (tables + indexes) via `CREATE TABLE IF NOT EXISTS`
- Seeds default metadata (`default_network = 'testnet'`)
- Exposes the raw `Database` instance for other services to run queries

No migrations — the schema is created fresh. If a future version needs schema changes, a version check + ALTER TABLE logic can be added to the initialization.

### 3. Refactored services

**`AccountStore`** — switches from `accounts.json` + `keys/{name}.json` to SQL queries against the `accounts` table. Calls `crypto.ts` for encrypt/decrypt. Drops `KeystoreV3` service dependency and `@effect/platform` FileSystem dependency.

**`HistoryStore`** — switches from `history.json` + `proper-lockfile` to SQL queries against the `history` table. Filtering and pagination become SQL `WHERE` + `LIMIT/OFFSET` instead of in-memory array operations.

**`NetworkConfig`** — switches from `networks.json` + `networks/{name}.json` to SQL queries against `custom_networks` and `metadata` tables. Bundled networks remain hardcoded in `config/bundled.ts` (unchanged).

## Database Schema

```sql
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
```

**Default metadata seeded on creation:**

```sql
INSERT OR IGNORE INTO metadata (key, value) VALUES ('default_network', 'testnet');
```

## What gets deleted

| File/Dep | Reason |
| --- | --- |
| `proper-lockfile` (npm dep) | SQLite WAL mode + transactions replace file locks |
| `services/keystore-v3.ts` | Replaced by `services/crypto.ts` |
| `schemas/keyfile.ts` | V3 keyfile format no longer used |
| `schemas/accounts.ts` | `AccountsFile` / `AccountEntry` Effect schemas no longer needed — data lives in SQL |
| `schemas/history.ts` | `HistoryFile` schema dropped; `HistoryEntry` kept as a plain TypeScript interface |
| `schemas/networks.ts` | `NetworksFile` schema dropped; `CustomNetworkConfig` schema kept for validation |
| `@effect/platform` FileSystem usage in account-store, history-store, network-config | Replaced by SQL queries via the database service |

## What stays unchanged

- `services/cli-config.ts` — CLI flag parsing, unrelated to storage
- `services/fast-rpc.ts` — RPC client, unrelated to storage
- `services/output.ts` — output formatting, unrelated to storage
- `services/password-service.ts` — password resolution, unrelated to storage
- `services/token-resolver.ts` — token lookup, unrelated to storage
- `config/bundled.ts` — bundled network definitions, unrelated to storage
- `errors/` — error types, unchanged (StorageError still used for DB failures)
- All command files — they consume service interfaces, which keep the same signatures
- `layers.ts` — updated to provide the new Database service, but structure unchanged

## Encryption flow

### Create account

```text
AccountStore.create(name, seed, password)
  → crypto.encryptSeed(seed, password) → encrypted blob (Uint8Array)
  → deriveAddresses(seed) → { fastAddress, evmAddress }
  → INSERT INTO accounts (name, fast_address, evm_address, encrypted_key, created_at)
```

### Export (decrypt) account

```text
AccountStore.export_(name, password)
  → SELECT encrypted_key FROM accounts WHERE name = ?
  → crypto.decryptSeed(blob, password) → seed (Uint8Array)
  → return { seed, accountInfo }
```

### Delete account

```text
AccountStore.delete_(name)
  → DELETE FROM accounts WHERE name = ?
```

## Service interface changes

The public interfaces (`AccountStoreShape`, `HistoryStoreShape`, `NetworkConfigShape`) stay the same — same method names, same parameters, same return types. Callers (command files) don't change. The only difference is the internal implementation switches from JSON I/O to SQL.

One interface change: `KeystoreV3Shape` is deleted. `AccountStore` calls `crypto.ts` functions directly instead of going through an Effect service tag.

## Dependencies

**Added:**

- `better-sqlite3` — SQLite driver with synchronous API and prebuilt binaries
- `@types/better-sqlite3` — TypeScript types (devDependency)

**Removed:**

- `proper-lockfile` + `@types/proper-lockfile`

## File layout after refactor

```text
app/cli/src/
  services/
    crypto.ts          (NEW — encrypt/decrypt module)
    database.ts        (NEW — SQLite service)
    account-store.ts   (REWRITTEN — SQL instead of JSON)
    history-store.ts   (REWRITTEN — SQL instead of JSON)
    network-config.ts  (REWRITTEN — SQL instead of JSON)
    cli-config.ts      (unchanged)
    fast-rpc.ts        (unchanged)
    output.ts          (unchanged)
    password-service.ts (unchanged)
    token-resolver.ts  (unchanged)
  schemas/
    history.ts         (SIMPLIFIED — HistoryEntry as plain interface, drop HistoryFile)
    networks.ts        (SIMPLIFIED — keep CustomNetworkConfig schema, drop NetworksFile)
    keyfile.ts         (DELETED)
    accounts.ts        (DELETED)
  layers.ts            (UPDATED — provide Database service, remove KeystoreV3)
```
