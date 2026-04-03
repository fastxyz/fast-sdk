import { homedir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer, Schema } from "effect";
import lockfile from "proper-lockfile";
import { StorageError, TxNotFoundError } from "../errors/index.js";
import { type HistoryEntry, HistoryFile } from "../schemas/history.js";

const FAST_DIR = join(homedir(), ".fast");
const HISTORY_FILE = join(FAST_DIR, "history.json");

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
}

export class HistoryStore extends Context.Tag("HistoryStore")<
  HistoryStore,
  HistoryStoreShape
>() {}

const ensureDir = (fs: FileSystem.FileSystem, path: string) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(path);
    if (!exists) {
      yield* fs.makeDirectory(path, { recursive: true });
    }
  }).pipe(
    Effect.mapError(
      (e) =>
        new StorageError({
          message: `Failed to create directory: ${path}`,
          cause: e,
        }),
    ),
  );

const readHistory = (
  fs: FileSystem.FileSystem,
): Effect.Effect<HistoryEntry[], StorageError> =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(HISTORY_FILE);
    if (!exists) return [];
    const content = yield* fs.readFileString(HISTORY_FILE);
    const parsed = JSON.parse(content);
    return yield* Schema.decodeUnknown(HistoryFile)(parsed);
  }).pipe(
    Effect.mapError(
      (e) =>
        new StorageError({ message: "Failed to read history.json", cause: e }),
    ),
  );

const writeHistory = (fs: FileSystem.FileSystem, entries: HistoryEntry[]) =>
  Effect.gen(function* () {
    yield* ensureDir(fs, FAST_DIR);
    yield* fs.writeFileString(HISTORY_FILE, JSON.stringify(entries, null, 2));
  }).pipe(
    Effect.mapError(
      (e) =>
        new StorageError({ message: "Failed to write history.json", cause: e }),
    ),
  );

const withLock = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E | StorageError> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => lockfile.lock(HISTORY_FILE, { realpath: false, retries: 3 }),
      catch: (cause) =>
        new StorageError({ message: "Failed to acquire history lock", cause }),
    }),
    () => effect,
    (release) =>
      Effect.tryPromise({
        try: () => release(),
        catch: () =>
          new StorageError({ message: "Failed to release history lock" }),
      }).pipe(Effect.orDie),
  );

export const HistoryStoreLive = Layer.effect(
  HistoryStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      record: (entry) =>
        Effect.gen(function* () {
          yield* ensureDir(fs, FAST_DIR);
          const exists = yield* fs.exists(HISTORY_FILE).pipe(
            Effect.mapError(
              (e) =>
                new StorageError({
                  message: "Failed to check history file",
                  cause: e,
                }),
            ),
          );
          if (!exists) {
            yield* writeHistory(fs, []);
          }
          yield* withLock(
            Effect.gen(function* () {
              const entries = yield* readHistory(fs);
              entries.unshift(entry);
              yield* writeHistory(fs, entries);
            }),
          );
        }),

      list: (filters) =>
        Effect.gen(function* () {
          let entries = yield* readHistory(fs);

          if (filters.from) {
            entries = entries.filter((e) => e.from === filters.from);
          }
          if (filters.to) {
            entries = entries.filter((e) => e.to === filters.to);
          }
          if (filters.token) {
            const t = filters.token.toLowerCase();
            entries = entries.filter(
              (e) =>
                e.tokenName.toLowerCase() === t || e.tokenId === filters.token,
            );
          }

          const offset = filters.offset ?? 0;
          const limit = filters.limit ?? 20;
          return entries.slice(offset, offset + limit);
        }),

      getByHash: (hash) =>
        Effect.gen(function* () {
          const entries = yield* readHistory(fs);
          const normalizedHash = hash.startsWith("0x") ? hash : `0x${hash}`;
          const entry = entries.find((e) => e.hash === normalizedHash);
          if (!entry) {
            return yield* Effect.fail(
              new TxNotFoundError({ hash: normalizedHash }),
            );
          }
          return entry;
        }),
    };
  }),
);
