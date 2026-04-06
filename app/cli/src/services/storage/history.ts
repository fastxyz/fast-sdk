import { and, desc, eq, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { history } from "../../db/schema.js";
import { StorageError, TxNotFoundError } from "../../errors/index.js";
import type { HistoryEntry } from "../../schemas/history.js";
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
  readonly list: (
    filters: HistoryFilters,
  ) => Effect.Effect<HistoryEntry[], StorageError>;
  readonly getByHash: (
    hash: string,
  ) => Effect.Effect<HistoryEntry, TxNotFoundError | StorageError>;
  readonly updateStatus: (
    hash: string,
    status: string,
  ) => Effect.Effect<void, StorageError>;
}

export class HistoryStore extends Context.Tag("HistoryStore")<
  HistoryStore,
  HistoryStoreShape
>() {}

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
            db.insert(history)
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
          },
          catch: (cause) =>
            new StorageError({
              message: "Failed to record history entry",
              cause,
            }),
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
                  eq(
                    sql`LOWER(${history.tokenName})`,
                    filters.token.toLowerCase(),
                  ),
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

            const rows =
              conditions.length > 0
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
            const row = db
              .select()
              .from(history)
              .where(eq(history.hash, normalized))
              .get();
            if (!row) throw new TxNotFoundError({ hash: normalized });
            return rowToEntry(row);
          },
          catch: (e) =>
            e instanceof TxNotFoundError
              ? e
              : new StorageError({
                  message: "Failed to get transaction",
                  cause: e,
                }),
        }),

      updateStatus: (hash, status) =>
        Effect.try({
          try: () => {
            db.update(history)
              .set({ status })
              .where(eq(history.hash, hash))
              .run();
          },
          catch: (cause) =>
            new StorageError({
              message: "Failed to update history status",
              cause,
            }),
        }),
    };
  }),
);
