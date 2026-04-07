<!-- markdownlint-disable MD013 -->
# Drizzle ORM Adoption

## Goal

Replace raw SQL strings in the three storage services with Drizzle's type-safe query builder. Add `drizzle-kit` for schema management (push now, generate+migrate at v1).

## Context

The SQLite storage refactor (just completed) introduced `better-sqlite3` with raw `db.prepare(...)` statements. This works but has two weaknesses: (1) manual `AccountRow` / `HistoryRow` interfaces duplicate the schema definition, and (2) future schema changes require hand-written `ALTER TABLE` statements. Drizzle provides type-safe queries derived from a single schema definition and a migration tool for schema evolution.

## Architecture

### Schema file

**`app/cli/src/db/schema.ts`** — single source of truth for all 4 tables. Uses `drizzle-orm/sqlite-core` table builders:

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

Column types are mapped to TypeScript automatically: `text()` → `string`, `integer({ mode: "boolean" })` → `boolean`, `blob({ mode: "buffer" })` → `Buffer`. No manual `AccountRow`/`HistoryRow` interfaces needed — Drizzle infers them.

### Database service

**`app/cli/src/services/database.ts`** changes:

- Keeps: `better-sqlite3` initialization, WAL mode, directory creation
- Adds: `drizzle(sqliteInstance)` wrapper that provides the typed `db` object
- Replaces: raw `initSchema()` SQL with `drizzle-kit push` at startup (reads `schema.ts`, diffs against live DB, applies changes)
- Exports: `DatabaseShape.db` changes from `Database.Database` (raw better-sqlite3) to `BetterSQLite3Database` (Drizzle wrapper)

### Service changes

Each service replaces raw prepared statements with Drizzle query builder calls:

```typescript
// Before (raw SQL)
const row = stmts.getByName.get(name);

// After (Drizzle)
const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
```

- `db.select().from(table).where(condition).get()` — single row (synchronous for better-sqlite3)
- `db.select().from(table).where(condition).all()` — multiple rows
- `db.insert(table).values({...}).run()` — insert
- `db.update(table).set({...}).where(condition).run()` — update
- `db.delete(table).where(condition).run()` — delete
- `db.transaction((tx) => { ... })` — atomic operations

All queries are synchronous when using better-sqlite3 + `.get()`/`.all()`/`.run()`.

### Type inference

Drizzle provides `$inferSelect` and `$inferInsert` on each table:

```typescript
type AccountSelect = typeof accounts.$inferSelect;
// { name: string; fastAddress: string; evmAddress: string; encryptedKey: Buffer; isDefault: boolean; createdAt: string }
```

The `AccountInfo` interface stays as the public API. A `rowToInfo` mapper converts from Drizzle's inferred type to `AccountInfo` (same pattern as now, but the input type is auto-derived).

## What changes

| File | Change |
| --- | --- |
| `app/cli/src/db/schema.ts` | **NEW** — 4 table definitions |
| `app/cli/src/services/database.ts` | Wrap `better-sqlite3` in `drizzle()`, remove raw `initSchema()` SQL, use push for schema sync |
| `app/cli/src/services/account/account-store.ts` | Replace `stmts.*` with Drizzle queries |
| `app/cli/src/services/history-store.ts` | Replace `stmts.*` with Drizzle queries |
| `app/cli/src/services/network-config.ts` | Replace `stmts.*` with Drizzle queries |
| `drizzle.config.ts` | **NEW** — drizzle-kit config (schema path, dialect, DB path) |

## What stays unchanged

- `crypto.ts` — no DB queries
- All command files — same service interfaces
- `layers.ts` — same `DatabaseLive` layer (just the internal type changes)
- `errors/` — same error types
- `schemas/history.ts`, `schemas/networks.ts` — keep for non-DB concerns (HistoryEntry interface, CustomNetworkConfig validation)

## Dependencies

**Added:**

- `drizzle-orm` — query builder + schema DSL
- `drizzle-kit` (devDep) — schema push/migration tool

**Kept:** `better-sqlite3` (Drizzle wraps it, doesn't replace it)

## Schema management strategy

**Now (pre-v1):** `drizzle-kit push` at startup. Change `schema.ts`, restart CLI, tables update automatically.

**At v1:** Switch to `drizzle-kit generate` (writes SQL migration files) + `migrate()` at startup (applies unapplied migrations). The `schema.ts` stays the same; only the initialization path changes.
