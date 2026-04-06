import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  bundledNetworks,
  isBundledNetwork,
  type NetworkConfig,
} from "../../config/bundled.js";
import { customNetworks, metadata } from "../../db/schema.js";
import {
  DefaultNetworkError,
  InvalidConfigError,
  NetworkExistsError,
  NetworkNotFoundError,
  NoDefaultNetworkError,
  ReservedNameError,
  StorageError,
} from "../../errors/index.js";
import { NetworkConfigSchema } from "../../schemas/networks.js";
import { DatabaseService, type DrizzleDB } from "./database.js";

type GetDefaultEffect = Effect.Effect<string, NoDefaultNetworkError>;
type ResolveEffect = Effect.Effect<
  NetworkConfig,
  NetworkNotFoundError | StorageError | InvalidConfigError
>;

export interface NetworkConfigShape {
  readonly resolve: (name: string) => ResolveEffect;
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
  readonly getDefault: () => GetDefaultEffect;
}

export class NetworkConfigService extends Context.Tag("NetworkConfigService")<
  NetworkConfigService,
  NetworkConfigShape
>() {}

const getDefault = (db: DrizzleDB): GetDefaultEffect => {
  const row = db
    .select()
    .from(metadata)
    .where(eq(metadata.key, "default_network"))
    .get();

  if (row?.value === undefined) {
    return Effect.fail(new NoDefaultNetworkError());
  }

  return Effect.succeed(row.value);
};

export const NetworkConfigLive = Layer.effect(
  NetworkConfigService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    return {
      resolve: (name) =>
        Effect.gen(function* () {
          const bundled = bundledNetworks[name];
          if (bundled) return bundled;

          const row = db
            .select()
            .from(customNetworks)
            .where(eq(customNetworks.name, name))
            .get();
          if (!row) {
            return yield* Effect.fail(new NetworkNotFoundError({ name }));
          }

          const config = yield* Schema.decodeUnknown(NetworkConfigSchema)(
            JSON.parse(row.config),
          ).pipe(
            Effect.mapError(
              () =>
                new InvalidConfigError({
                  message: `Invalid network config: ${name}`,
                }),
            ),
          );

          return {
            rpcUrl: config.rpcUrl,
            explorerUrl: config.explorerUrl,
            networkId: config.networkId,
            ...(Option.isSome(config.allSet)
              ? { allSet: config.allSet.value }
              : {}),
          } satisfies NetworkConfig;
        }),

      list: () =>
        Effect.try({
          try: () => {
            const defaultName = getDefault(db);
            const customRows = db
              .select({ name: customNetworks.name })
              .from(customNetworks)
              .all();
            const allNames = [
              ...Object.keys(bundledNetworks),
              ...customRows.map((r) => r.name),
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
            if (
              !isBundledNetwork(name) &&
              !db
                .select()
                .from(customNetworks)
                .where(eq(customNetworks.name, name))
                .get()
            ) {
              throw new NetworkNotFoundError({ name });
            }
            db.insert(metadata)
              .values({ key: "default_network", value: name })
              .onConflictDoUpdate({
                target: metadata.key,
                set: { value: name },
              })
              .run();
          },
          catch: (e) =>
            e instanceof NetworkNotFoundError
              ? e
              : new StorageError({
                  message: "Failed to set default network",
                  cause: e,
                }),
        }),

      add: (name, configPath) =>
        Effect.gen(function* () {
          if (isBundledNetwork(name)) {
            return yield* Effect.fail(new ReservedNameError({ name }));
          }
          if (
            db
              .select()
              .from(customNetworks)
              .where(eq(customNetworks.name, name))
              .get()
          ) {
            return yield* Effect.fail(new NetworkExistsError({ name }));
          }

          const raw = yield* Effect.try({
            try: () => readFileSync(configPath, "utf-8"),
            catch: () =>
              new InvalidConfigError({
                message: `Cannot read config file: ${configPath}`,
              }),
          });

          // Validate against NetworkConfigSchema (same shape as NetworkConfig)
          yield* Schema.decodeUnknown(NetworkConfigSchema)(
            JSON.parse(raw),
          ).pipe(
            Effect.mapError(
              () =>
                new InvalidConfigError({
                  message: "Invalid network config format",
                }),
            ),
          );

          // Store the validated JSON as-is — resolve() reads it back directly
          yield* Effect.try({
            try: () =>
              db.insert(customNetworks).values({ name, config: raw }).run(),
            catch: (cause) =>
              new StorageError({
                message: "Failed to save network config",
                cause,
              }),
          });
        }),

      remove: (name) =>
        Effect.try({
          try: () => {
            if (isBundledNetwork(name)) throw new ReservedNameError({ name });
            if (
              !db
                .select()
                .from(customNetworks)
                .where(eq(customNetworks.name, name))
                .get()
            ) {
              throw new NetworkNotFoundError({ name });
            }
            if (getDefault() === name) throw new DefaultNetworkError({ name });
            db.delete(customNetworks)
              .where(eq(customNetworks.name, name))
              .run();
          },
          catch: (e) =>
            e instanceof ReservedNameError ||
            e instanceof NetworkNotFoundError ||
            e instanceof DefaultNetworkError
              ? e
              : new StorageError({
                  message: "Failed to remove network",
                  cause: e,
                }),
        }),

      getDefault: () => getDefault(db),
    };
  }),
);
