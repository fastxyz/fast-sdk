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
  ReservedNameError,
  StorageError,
} from "../../errors/index.js";
import { CustomNetworkConfig } from "../../schemas/networks.js";
import { DatabaseService } from "./database.js";

export interface NetworkConfigShape {
  readonly resolve: (
    name: string,
  ) => Effect.Effect<
    NetworkConfig,
    NetworkNotFoundError | StorageError | InvalidConfigError
  >;
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
  readonly getDefault: () => Effect.Effect<string, StorageError>;
}

export class NetworkConfigService extends Context.Tag("NetworkConfigService")<
  NetworkConfigService,
  NetworkConfigShape
>() {}

export const NetworkConfigLive = Layer.effect(
  NetworkConfigService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const getDefaultNetwork = (): string => {
      const row = db
        .select()
        .from(metadata)
        .where(eq(metadata.key, "default_network"))
        .get();
      return row?.value ?? "testnet";
    };

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

          const custom = yield* Schema.decodeUnknown(CustomNetworkConfig)(
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
            rpcUrl: custom.fast.rpcUrl,
            explorerUrl: custom.fast.explorerUrl,
            networkId: `fast:${name}`,
            ...(Option.isSome(custom.allSet)
              ? { allSet: custom.allSet.value }
              : {}),
          } satisfies NetworkConfig;
        }),

      list: () =>
        Effect.try({
          try: () => {
            const defaultName = getDefaultNetwork();
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

          const content = yield* Effect.try({
            try: () => readFileSync(configPath, "utf-8"),
            catch: () =>
              new InvalidConfigError({
                message: `Cannot read config file: ${configPath}`,
              }),
          });

          yield* Schema.decodeUnknown(CustomNetworkConfig)(
            JSON.parse(content),
          ).pipe(
            Effect.mapError(
              () =>
                new InvalidConfigError({
                  message: "Invalid network config format",
                }),
            ),
          );

          yield* Effect.try({
            try: () =>
              db.insert(customNetworks).values({ name, config: content }).run(),
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
            if (getDefaultNetwork() === name)
              throw new DefaultNetworkError({ name });
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

      getDefault: () =>
        Effect.try({
          try: () => getDefaultNetwork(),
          catch: (cause) =>
            new StorageError({
              message: "Failed to get default network",
              cause,
            }),
        }),
    };
  }),
);
