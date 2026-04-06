import { homedir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  bundledNetworks,
  isBundledNetwork,
  type NetworkConfig,
} from "../config/bundled.js";
import {
  DefaultNetworkError,
  InvalidConfigError,
  mapToStorageError,
  NetworkExistsError,
  NetworkNotFoundError,
  ReservedNameError,
  type StorageError,
} from "../errors/index.js";
import { CustomNetworkConfig, NetworksFile } from "../schemas/networks.js";

const FAST_DIR = join(homedir(), ".fast");
const NETWORKS_FILE = join(FAST_DIR, "networks.json");
const NETWORKS_DIR = join(FAST_DIR, "networks");

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

export class NetworkConfigService extends Context.Tag("NetworkConfig")<
  NetworkConfigService,
  NetworkConfigShape
>() {}

const ensureDir = (fs: FileSystem.FileSystem, path: string) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(path);
    if (!exists) {
      yield* fs.makeDirectory(path, { recursive: true });
    }
  }).pipe(mapToStorageError(`create directory: ${path}`));

const readNetworksFile = (fs: FileSystem.FileSystem) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(NETWORKS_FILE);
    if (!exists) {
      return new NetworksFile({
        default: "testnet",
        networks: ["testnet", "mainnet"],
      });
    }
    const content = yield* fs.readFileString(NETWORKS_FILE);
    return yield* Schema.decodeUnknown(NetworksFile)(JSON.parse(content));
  }).pipe(mapToStorageError("read networks.json"));

const writeNetworksFile = (fs: FileSystem.FileSystem, data: NetworksFile) =>
  Effect.gen(function* () {
    yield* ensureDir(fs, FAST_DIR);
    yield* fs.writeFileString(NETWORKS_FILE, JSON.stringify(data, null, 2));
  }).pipe(mapToStorageError("write networks.json"));

export const NetworkConfigLive = Layer.effect(
  NetworkConfigService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      resolve: (name) =>
        Effect.gen(function* () {
          const bundled = bundledNetworks[name];
          if (bundled) return bundled;

          const configPath = join(NETWORKS_DIR, `${name}.json`);
          const exists = yield* fs
            .exists(configPath)
            .pipe(mapToStorageError("check network config"));
          if (!exists) {
            return yield* Effect.fail(new NetworkNotFoundError({ name }));
          }

          const content = yield* fs
            .readFileString(configPath)
            .pipe(mapToStorageError(`read network config: ${name}`));
          const custom = yield* Schema.decodeUnknown(CustomNetworkConfig)(
            JSON.parse(content),
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
            ...(Option.isSome(custom.allset)
              ? { allset: custom.allset.value }
              : {}),
          } satisfies NetworkConfig;
        }),

      list: () =>
        Effect.gen(function* () {
          const data = yield* readNetworksFile(fs);
          return data.networks.map((name) => ({
            name,
            type: (isBundledNetwork(name) ? "bundled" : "custom") as
              | "bundled"
              | "custom",
            isDefault: name === data.default,
          }));
        }),

      setDefault: (name) =>
        Effect.gen(function* () {
          const data = yield* readNetworksFile(fs);
          if (!data.networks.includes(name)) {
            return yield* Effect.fail(new NetworkNotFoundError({ name }));
          }
          yield* writeNetworksFile(
            fs,
            new NetworksFile({ ...data, default: name }),
          );
        }),

      add: (name, configPath) =>
        Effect.gen(function* () {
          if (isBundledNetwork(name)) {
            return yield* Effect.fail(new ReservedNameError({ name }));
          }
          const data = yield* readNetworksFile(fs);
          if (data.networks.includes(name)) {
            return yield* Effect.fail(new NetworkExistsError({ name }));
          }

          const content = yield* fs.readFileString(configPath).pipe(
            Effect.mapError(
              () =>
                new InvalidConfigError({
                  message: `Cannot read config file: ${configPath}`,
                }),
            ),
          );
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

          yield* ensureDir(fs, NETWORKS_DIR);
          yield* fs
            .writeFileString(join(NETWORKS_DIR, `${name}.json`), content)
            .pipe(mapToStorageError("write network config"));

          yield* writeNetworksFile(
            fs,
            new NetworksFile({
              ...data,
              networks: [...data.networks, name],
            }),
          );
        }),

      remove: (name) =>
        Effect.gen(function* () {
          if (isBundledNetwork(name)) {
            return yield* Effect.fail(new ReservedNameError({ name }));
          }
          const data = yield* readNetworksFile(fs);
          if (!data.networks.includes(name)) {
            return yield* Effect.fail(new NetworkNotFoundError({ name }));
          }
          if (data.default === name) {
            return yield* Effect.fail(new DefaultNetworkError({ name }));
          }

          const configPath = join(NETWORKS_DIR, `${name}.json`);
          yield* fs
            .remove(configPath)
            .pipe(mapToStorageError("remove network config"));

          yield* writeNetworksFile(
            fs,
            new NetworksFile({
              ...data,
              networks: data.networks.filter((n) => n !== name),
            }),
          );
        }),

      getDefault: () =>
        Effect.gen(function* () {
          const data = yield* readNetworksFile(fs);
          return data.default;
        }),
    };
  }),
);
