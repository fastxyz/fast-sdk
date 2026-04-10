import { and, desc, eq, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { history } from "../../db/schema.js";
import { TxNotFoundError } from "../../errors/index.js";
import type { HistoryEntry } from "../../schemas/history.js";
import { DatabaseService, type DatabaseShape, type DrizzleDB } from "./database.js";

export interface HistoryFilters {
  readonly from?: string;
  readonly to?: string;
  readonly token?: string;
  readonly limit?: number;
  readonly offset?: number;
}

// ── Pure helpers ───────────────────���────────────────────────��────────────────

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

// ── Raw DB helpers ──────────��───────────────────────────────────────────────

const insertHistoryEntry = (db: DrizzleDB, entry: HistoryEntry) =>
  db
    .insert(history)
    .values({
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
    })
    .onConflictDoUpdate({
      target: history.hash,
      set: { status: entry.status },
    })
    .run();

const queryHistory = (db: DrizzleDB, filters: HistoryFilters) => {
  const conditions = [];

  if (filters.from) conditions.push(eq(history.from, filters.from));
  if (filters.to) conditions.push(eq(history.to, filters.to));
  if (filters.token) {
    conditions.push(
      or(
        eq(sql`LOWER(${history.tokenName})`, filters.token.toLowerCase()),
        eq(history.tokenId, filters.token),
      )!,
    );
  }

  const q = db
    .select()
    .from(history)
    .orderBy(desc(history.timestamp))
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);

  return conditions.length > 0 ? q.where(and(...conditions)).all() : q.all();
};

const findByHash = (db: DrizzleDB, hash: string) => {
  const normalized = hash.startsWith("0x") ? hash : `0x${hash}`;
  return { row: db.select().from(history).where(eq(history.hash, normalized)).get(), normalized };
};

// ── Effect-level operations ───────────────��─────────────────────────────────

const record = (handle: DatabaseShape, entry: HistoryEntry) =>
  handle.query(
    (db) => insertHistoryEntry(db, entry),
    "Failed to record history entry",
  );

const list = (handle: DatabaseShape, filters: HistoryFilters) =>
  Effect.map(
    handle.query((db) => queryHistory(db, filters), "Failed to list history"),
    (rows) => rows.map(rowToEntry),
  );

const getByHash = (handle: DatabaseShape, hash: string) =>
  Effect.gen(function* () {
    const { row, normalized } = yield* handle.query(
      (db) => findByHash(db, hash),
      "Failed to get transaction",
    );
    if (!row) return yield* Effect.fail(new TxNotFoundError({ hash: normalized }));
    return rowToEntry(row);
  });

const updateStatus = (handle: DatabaseShape, hash: string, status: string) =>
  handle.query(
    (db) => db.update(history).set({ status }).where(eq(history.hash, hash)).run(),
    "Failed to update history status",
  );

// ── Service ───────���─────────────────────────────────────────────────────────

const ServiceEffect = Effect.gen(function* () {
  const handle = yield* DatabaseService;

  return {
    record: (entry: HistoryEntry) => record(handle, entry),
    list: (filters: HistoryFilters) => list(handle, filters),
    getByHash: (hash: string) => getByHash(handle, hash),
    updateStatus: (hash: string, status: string) => updateStatus(handle, hash, status),
  };
});

export class HistoryStore extends Effect.Service<HistoryStore>()(
  "HistoryStore",
  { effect: ServiceEffect },
) {}
