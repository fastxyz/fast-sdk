import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Context, Effect, Layer } from "effect";
import * as schema from "../../db/schema.js";
import { DatabaseError } from "../../errors/index.js";

const FAST_DIR = join(homedir(), ".fast");
const DB_PATH = join(FAST_DIR, "fast.db");

export type DrizzleDB = BetterSQLite3Database<typeof schema>;

export interface DatabaseShape {
  readonly query: <A>(
    fn: (db: DrizzleDB) => A,
    message: string,
  ) => Effect.Effect<A, DatabaseError>;
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

  // Apply migrations from the generated drizzle/ folder.
  // drizzle-kit generate creates these from db/schema.ts.
  // Resolve the migrations folder for both tsx-from-source and compiled-dist modes:
  //   tsx:   import.meta.url → src/services/storage/ → ../../../drizzle = app/cli/drizzle/
  //   built: import.meta.url → dist/ → ../drizzle = app/cli/drizzle/
  const __dir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = [join(__dir, "../../../drizzle"), join(__dir, "../drizzle")].find(
    (p) => existsSync(join(p, "meta/_journal.json")),
  );
  if (!migrationsFolder) {
    throw new Error("Could not locate Drizzle migrations folder");
  }
  migrate(db, { migrationsFolder });

  // Seed defaults
  db.insert(schema.metadata)
    .values({ key: "default_network", value: "mainnet" })
    .onConflictDoNothing()
    .run();

  return {
    query: (fn, message) =>
      Effect.try({
        try: () => fn(db),
        catch: (cause) => new DatabaseError({ message, cause }),
      }),
  };
});
