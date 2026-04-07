import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { customNetworks, metadata } from "../../db/schema.js";
import {
  DefaultNetworkError,
  FileIOError,
  InvalidNetworkConfigError,
  NetworkExistsError,
  NetworkNotFoundError,
  NoDefaultNetworkError,
  ReservedNameError,
} from "../../errors/index.js";
import { NetworkConfigSchema } from "../../schemas/networks.js";
import type { AppConfigShape } from "../config/app.js";
import { AppConfig } from "../config/app.js";
import {
  DatabaseService,
  type DatabaseShape,
  type DrizzleDB,
} from "./database.js";

const getDefaultNetwork = (db: DrizzleDB) =>
  db.select().from(metadata).where(eq(metadata.key, "default_network")).get();

const listCustomNetworks = (db: DrizzleDB) =>
  db.select({ name: customNetworks.name }).from(customNetworks).all();

const getCustomNetwork = (db: DrizzleDB, name: string) =>
  db.select().from(customNetworks).where(eq(customNetworks.name, name)).get();

const setDefaultNetwork = (db: DrizzleDB, name: string) =>
  db
    .insert(metadata)
    .values({ key: "default_network", value: name })
    .onConflictDoUpdate({ target: metadata.key, set: { value: name } })
    .run();

const deleteCustomNetwork = (db: DrizzleDB, name: string) =>
  db.delete(customNetworks).where(eq(customNetworks.name, name)).run();

type Context = {
  handle: DatabaseShape;
  config: AppConfigShape;
};

const getDefault = (handle: DatabaseShape) =>
  Effect.flatMap(
    handle.query(
      (db) => getDefaultNetwork(db),
      "Failed to get default network",
    ),
    (row) =>
      row?.value !== undefined
        ? Effect.succeed(row.value)
        : Effect.fail(new NoDefaultNetworkError()),
  );

const resolve = (context: Context, name: string) =>
  Effect.gen(function* () {
    const bundled = context.config.getBundledNetwork(name);
    if (bundled) return bundled;

    const row = yield* context.handle.query(
      (db) => getCustomNetwork(db, name),
      "Failed to get network config",
    );

    if (!row) {
      return yield* Effect.fail(new NetworkNotFoundError({ name }));
    }

    const json = JSON.parse(row.config);
    return yield* Schema.decodeUnknown(NetworkConfigSchema)(json).pipe(
      Effect.mapError(() => new InvalidNetworkConfigError({ name })),
    );
  });

const list = (context: Context) =>
  Effect.gen(function* () {
    const defaultName = yield* getDefault(context.handle);
    const customRows = yield* context.handle.query(
      (db) => listCustomNetworks(db),
      "Failed to list networks",
    );
    const names = [
      ...Object.keys(context.config.bundledNetworks),
      ...customRows.map((r) => r.name),
    ];
    return names.map((name) => {
      const type = context.config.isBundledNetwork(name) ? "bundled" : "custom";
      const isDefault = name === defaultName;
      return { name, type, isDefault };
    });
  });

const setDefault = (context: Context, name: string) =>
  Effect.gen(function* () {
    if (!context.config.isBundledNetwork(name)) {
      const row = yield* context.handle.query(
        (db) => getCustomNetwork(db, name),
        "Failed to get network config",
      );
      if (!row) return yield* Effect.fail(new NetworkNotFoundError({ name }));
    }
    yield* context.handle.query(
      (db) => setDefaultNetwork(db, name),
      "Failed to set default network",
    );
  });

const add = (context: Context, name: string, configPath: string) =>
  Effect.gen(function* () {
    if (context.config.isBundledNetwork(name)) {
      return yield* Effect.fail(new ReservedNameError({ name }));
    }

    const existing = yield* context.handle.query(
      (db) => getCustomNetwork(db, name),
      "Failed to check existing networks",
    );
    if (existing) {
      return yield* Effect.fail(new NetworkExistsError({ name }));
    }

    const raw = yield* Effect.try({
      try: () => readFileSync(configPath, "utf-8"),
      catch: (cause) =>
        new FileIOError({
          message: `Failed to read network config file at "${configPath}"`,
          cause,
        }),
    });

    yield* Schema.decodeUnknown(NetworkConfigSchema)(JSON.parse(raw)).pipe(
      Effect.mapError(() => new InvalidNetworkConfigError({ name })),
    );

    yield* context.handle.query(
      (db) => db.insert(customNetworks).values({ name, config: raw }).run(),
      "Failed to save network config",
    );
  });

const remove = (context: Context, name: string) =>
  Effect.gen(function* () {
    if (context.config.isBundledNetwork(name)) {
      return yield* Effect.fail(new ReservedNameError({ name }));
    }

    const row = yield* context.handle.query(
      (db) => getCustomNetwork(db, name),
      "Failed to check network exists",
    );
    if (!row) {
      return yield* Effect.fail(new NetworkNotFoundError({ name }));
    }

    const defaultName = yield* getDefault(context.handle);
    if (defaultName === name) {
      return yield* Effect.fail(new DefaultNetworkError({ name }));
    }

    yield* context.handle.query(
      (db) => deleteCustomNetwork(db, name),
      "Failed to remove network",
    );
  });

const ServiceEffect = Effect.gen(function* () {
  const handle = yield* DatabaseService;
  const config = yield* AppConfig;
  const context = { handle, config };

  return {
    resolve: (name: string) => resolve(context, name),
    list: () => list(context),
    setDefault: (name: string) => setDefault(context, name),
    add: (name: string, configPath: string) => add(context, name, configPath),
    remove: (name: string) => remove(context, name),
    getDefault: () => getDefault(context.handle),
  };
});

export class NetworkConfigService extends Effect.Service<NetworkConfigService>()(
  "NetworkConfigService",
  { effect: ServiceEffect },
) {}
