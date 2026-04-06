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
