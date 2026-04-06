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
