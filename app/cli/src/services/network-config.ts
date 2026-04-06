import { readFileSync } from "node:fs";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  bundledNetworks,
  isBundledNetwork,
  type NetworkConfig,
} from "../config/bundled.js";
import {
  DefaultNetworkError,
  InvalidConfigError,
  NetworkExistsError,
  NetworkNotFoundError,
  ReservedNameError,
  StorageError,
} from "../errors/index.js";
import { CustomNetworkConfig } from "../schemas/networks.js";
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

    const stmts = {
      getConfig: db.prepare<[string], { config: string }>(
        "SELECT config FROM custom_networks WHERE name = ?",
      ),
      listCustom: db.prepare<[], { name: string }>("SELECT name FROM custom_networks"),
      insertConfig: db.prepare(
        "INSERT INTO custom_networks (name, config) VALUES (?, ?)",
      ),
      deleteConfig: db.prepare("DELETE FROM custom_networks WHERE name = ?"),
      getMeta: db.prepare<[string], { value: string }>(
        "SELECT value FROM metadata WHERE key = ?",
      ),
      setMeta: db.prepare(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
      ),
    };

    const getDefaultNetwork = (): string =>
      stmts.getMeta.get("default_network")?.value ?? "testnet";

    return {
      resolve: (name) =>
        Effect.gen(function* () {
          const bundled = bundledNetworks[name];
          if (bundled) return bundled;

          const row = stmts.getConfig.get(name);
          if (!row) {
            return yield* Effect.fail(new NetworkNotFoundError({ name }));
          }

          const custom = yield* Schema.decodeUnknown(CustomNetworkConfig)(
            JSON.parse(row.config),
          ).pipe(
            Effect.mapError(
              () => new InvalidConfigError({ message: `Invalid network config: ${name}` }),
            ),
          );

          return {
            rpcUrl: custom.fast.rpcUrl,
            explorerUrl: custom.fast.explorerUrl,
            networkId: `fast:${name}`,
            ...(Option.isSome(custom.allset)
              ? { allset: custom.allset.value }
              : {}),
          } satisfies NetworkConfig;
        }),

      list: () =>
        Effect.try({
          try: () => {
            const defaultName = getDefaultNetwork();
            const customNames = stmts.listCustom.all().map((r) => r.name);
            const allNames = [
              ...Object.keys(bundledNetworks),
              ...customNames,
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
            if (!isBundledNetwork(name) && !stmts.getConfig.get(name)) {
              throw new NetworkNotFoundError({ name });
            }
            stmts.setMeta.run("default_network", name);
          },
          catch: (e) =>
            e instanceof NetworkNotFoundError
              ? e
              : new StorageError({ message: "Failed to set default network", cause: e }),
        }),

      add: (name, configPath) =>
        Effect.gen(function* () {
          if (isBundledNetwork(name)) {
            return yield* Effect.fail(new ReservedNameError({ name }));
          }
          if (stmts.getConfig.get(name)) {
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
            try: () => stmts.insertConfig.run(name, content),
            catch: (cause) =>
              new StorageError({ message: "Failed to save network config", cause }),
          });
        }),

      remove: (name) =>
        Effect.try({
          try: () => {
            if (isBundledNetwork(name)) {
              throw new ReservedNameError({ name });
            }
            if (!stmts.getConfig.get(name)) {
              throw new NetworkNotFoundError({ name });
            }
            if (getDefaultNetwork() === name) {
              throw new DefaultNetworkError({ name });
            }
            stmts.deleteConfig.run(name);
          },
          catch: (e) =>
            e instanceof ReservedNameError ||
            e instanceof NetworkNotFoundError ||
            e instanceof DefaultNetworkError
              ? e
              : new StorageError({ message: "Failed to remove network", cause: e }),
        }),

      getDefault: () =>
        Effect.try({
          try: () => getDefaultNetwork(),
          catch: (cause) =>
            new StorageError({ message: "Failed to get default network", cause }),
        }),
    };
  }),
);
