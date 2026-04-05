import { homedir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@effect/platform";
import { Signer, toHex } from "@fastxyz/fast-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { Context, Effect, Layer, Option, Schema } from "effect";
import lockfile from "proper-lockfile";
import {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoAccountsError,
  StorageError,
  type WrongPasswordError,
  mapToStorageError,
} from "../errors/index.js";
import { AccountEntry, AccountsFile } from "../schemas/accounts.js";
import { KeyfileV3 } from "../schemas/keyfile.js";
import { KeystoreV3 } from "./keystore-v3.js";

const FAST_DIR = join(homedir(), ".fast");
const ACCOUNTS_FILE = join(FAST_DIR, "accounts.json");
const KEYS_DIR = join(FAST_DIR, "keys");

export interface AccountInfo {
  readonly name: string;
  readonly fastAddress: string;
  readonly evmAddress: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
}

export interface AccountStoreShape {
  readonly list: () => Effect.Effect<AccountInfo[], StorageError>;
  readonly get: (
    name: string,
  ) => Effect.Effect<AccountInfo, AccountNotFoundError | StorageError>;
  readonly getDefault: () => Effect.Effect<
    AccountInfo,
    NoAccountsError | StorageError
  >;
  readonly create: (
    name: string,
    seed: Uint8Array,
    password: string,
  ) => Effect.Effect<AccountInfo, AccountExistsError | StorageError>;
  readonly import_: (
    name: string,
    seed: Uint8Array,
    password: string,
  ) => Effect.Effect<AccountInfo, AccountExistsError | StorageError>;
  readonly setDefault: (
    name: string,
  ) => Effect.Effect<void, AccountNotFoundError | StorageError>;
  readonly delete_: (
    name: string,
  ) => Effect.Effect<
    void,
    AccountNotFoundError | DefaultAccountError | StorageError
  >;
  readonly export_: (
    name: string,
    password: string,
  ) => Effect.Effect<
    { seed: Uint8Array; entry: AccountInfo },
    AccountNotFoundError | WrongPasswordError | StorageError
  >;
  readonly resolveAccount: (
    flag: Option.Option<string>,
  ) => Effect.Effect<
    AccountInfo,
    AccountNotFoundError | NoAccountsError | StorageError
  >;
  readonly nextAutoName: () => Effect.Effect<string, StorageError>;
}

export class AccountStore extends Context.Tag("AccountStore")<
  AccountStore,
  AccountStoreShape
>() {}

const ensureDir = (fs: FileSystem.FileSystem, path: string, mode?: number) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(path);
    if (!exists) {
      yield* fs.makeDirectory(path, { recursive: true });
    }
    if (mode !== undefined) {
      yield* Effect.tryPromise({
        try: async () => {
          const nodeFs = await import("node:fs");
          await nodeFs.promises.chmod(path, mode);
        },
        catch: () => undefined,
      }).pipe(Effect.ignore);
    }
  }).pipe(mapToStorageError(`create directory: ${path}`));

const readAccountsFile = (
  fs: FileSystem.FileSystem,
): Effect.Effect<AccountsFile, StorageError> =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(ACCOUNTS_FILE);
    if (!exists) {
      return new AccountsFile({ default: null, accounts: [] });
    }
    const content = yield* fs.readFileString(ACCOUNTS_FILE);
    return yield* Schema.decodeUnknown(AccountsFile)(JSON.parse(content));
  }).pipe(mapToStorageError('read accounts.json'));

const writeAccountsFile = (fs: FileSystem.FileSystem, data: AccountsFile) =>
  Effect.gen(function* () {
    yield* ensureDir(fs, FAST_DIR, 0o700);
    yield* fs.writeFileString(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
  }).pipe(mapToStorageError('write accounts.json'));

const readKeyfile = (
  fs: FileSystem.FileSystem,
  name: string,
): Effect.Effect<KeyfileV3, StorageError> =>
  Effect.gen(function* () {
    const path = join(KEYS_DIR, `${name}.json`);
    const content = yield* fs.readFileString(path);
    return yield* Schema.decodeUnknown(KeyfileV3)(JSON.parse(content));
  }).pipe(mapToStorageError(`read keyfile for "${name}"`));

const writeKeyfile = (
  fs: FileSystem.FileSystem,
  name: string,
  keyfile: KeyfileV3,
) =>
  Effect.gen(function* () {
    yield* ensureDir(fs, KEYS_DIR);
    const path = join(KEYS_DIR, `${name}.json`);
    yield* fs.writeFileString(path, JSON.stringify(keyfile, null, 2));
    yield* Effect.tryPromise({
      try: async () => {
        const nodeFs = await import("node:fs");
        await nodeFs.promises.chmod(path, 0o600);
      },
      catch: () => undefined,
    }).pipe(Effect.ignore);
  }).pipe(mapToStorageError(`write keyfile for "${name}"`));

const withAccountLock = <A, E>(
  fs: FileSystem.FileSystem,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E | StorageError> =>
  Effect.gen(function* () {
    yield* ensureDir(fs, FAST_DIR, 0o700);
    const exists = yield* fs.exists(ACCOUNTS_FILE).pipe(
      mapToStorageError('check accounts file'),
    );
    if (!exists) {
      yield* writeAccountsFile(
        fs,
        new AccountsFile({ default: null, accounts: [] }),
      );
    }
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () =>
          lockfile.lock(ACCOUNTS_FILE, { realpath: false, retries: 3 }),
        catch: (cause) =>
          new StorageError({
            message: "Failed to acquire account lock",
            cause,
          }),
      }),
      () => effect,
      (release) =>
        Effect.tryPromise({
          try: () => release(),
          catch: () =>
            new StorageError({ message: "Failed to release account lock" }),
        }).pipe(Effect.orDie),
    );
  });

const deriveEvmAddress = (seed: Uint8Array): string => {
  const pubkey = secp256k1.getPublicKey(seed, false);
  const hash = keccak_256(pubkey.slice(1));
  const addressBytes = hash.slice(-20);
  return toHex(addressBytes);
};

const deriveAddresses = (seed: Uint8Array) =>
  Effect.gen(function* () {
    const signer = new Signer(seed);
    const fastAddress = yield* Effect.tryPromise({
      try: () => signer.getFastAddress(),
      catch: (cause) =>
        new StorageError({ message: "Failed to derive Fast address", cause }),
    });
    const evmAddress = deriveEvmAddress(seed);
    return { fastAddress, evmAddress };
  });

export const AccountStoreLive = Layer.effect(
  AccountStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const keystore = yield* KeystoreV3;

    const toAccountInfo = (
      entry: AccountEntry,
      keyfile: KeyfileV3,
      defaultName: string | null,
    ): AccountInfo => ({
      name: entry.name,
      fastAddress: keyfile.fastAddress,
      evmAddress: keyfile.evmAddress,
      isDefault: entry.name === defaultName,
      createdAt: entry.createdAt,
    });

    const storeAccount = (
      name: string,
      seed: Uint8Array,
      password: string,
    ): Effect.Effect<AccountInfo, AccountExistsError | StorageError> =>
      withAccountLock(
        fs,
        Effect.gen(function* () {
          const data = yield* readAccountsFile(fs);
          if (data.accounts.some((a) => a.name === name)) {
            return yield* Effect.fail(new AccountExistsError({ name }));
          }

          const { fastAddress, evmAddress } = yield* deriveAddresses(seed);
          const keyfile = yield* keystore
            .encrypt(seed, password, fastAddress, evmAddress)
            .pipe(mapToStorageError('encrypt keyfile'));
          yield* writeKeyfile(fs, name, keyfile);

          const newDefault = data.default ?? name;
          const newEntry = new AccountEntry({
            name,
            createdAt: new Date().toISOString(),
          });
          const newData = new AccountsFile({
            default: newDefault,
            accounts: [...data.accounts, newEntry],
          });
          yield* writeAccountsFile(fs, newData);

          return {
            name,
            fastAddress,
            evmAddress,
            isDefault: newDefault === name,
            createdAt: newEntry.createdAt,
          };
        }),
      );

    return {
      list: () =>
        Effect.gen(function* () {
          const data = yield* readAccountsFile(fs);
          const results: AccountInfo[] = [];
          for (const entry of data.accounts) {
            const keyfile = yield* readKeyfile(fs, entry.name);
            results.push(toAccountInfo(entry, keyfile, data.default));
          }
          return results;
        }),

      get: (name) =>
        Effect.gen(function* () {
          const data = yield* readAccountsFile(fs);
          const entry = data.accounts.find((a) => a.name === name);
          if (!entry) {
            return yield* Effect.fail(new AccountNotFoundError({ name }));
          }
          const keyfile = yield* readKeyfile(fs, name);
          return toAccountInfo(entry, keyfile, data.default);
        }),

      getDefault: () =>
        Effect.gen(function* () {
          const data = yield* readAccountsFile(fs);
          if (!data.default || data.accounts.length === 0) {
            return yield* Effect.fail(new NoAccountsError());
          }
          const entry = data.accounts.find((a) => a.name === data.default);
          if (!entry) {
            return yield* Effect.fail(new NoAccountsError());
          }
          const keyfile = yield* readKeyfile(fs, entry.name);
          return toAccountInfo(entry, keyfile, data.default);
        }),

      create: (name, seed, password) => storeAccount(name, seed, password),
      import_: (name, seed, password) => storeAccount(name, seed, password),

      setDefault: (name) =>
        withAccountLock(
          fs,
          Effect.gen(function* () {
            const data = yield* readAccountsFile(fs);
            if (!data.accounts.some((a) => a.name === name)) {
              return yield* Effect.fail(new AccountNotFoundError({ name }));
            }
            yield* writeAccountsFile(
              fs,
              new AccountsFile({ ...data, default: name }),
            );
          }),
        ),

      delete_: (name) =>
        withAccountLock(
          fs,
          Effect.gen(function* () {
            const data = yield* readAccountsFile(fs);
            const entry = data.accounts.find((a) => a.name === name);
            if (!entry) {
              return yield* Effect.fail(new AccountNotFoundError({ name }));
            }
            if (data.default === name && data.accounts.length > 1) {
              return yield* Effect.fail(new DefaultAccountError({ name }));
            }

            const keyPath = join(KEYS_DIR, `${name}.json`);
            yield* fs.remove(keyPath).pipe(mapToStorageError(`delete keyfile for "${name}"`));

            const remaining = data.accounts.filter((a) => a.name !== name);
            const newDefault =
              remaining.length === 0
                ? null
                : data.default === name
                  ? null
                  : data.default;
            yield* writeAccountsFile(
              fs,
              new AccountsFile({ default: newDefault, accounts: remaining }),
            );
          }),
        ),

      export_: (name, password) =>
        Effect.gen(function* () {
          const data = yield* readAccountsFile(fs);
          const entry = data.accounts.find((a) => a.name === name);
          if (!entry) {
            return yield* Effect.fail(new AccountNotFoundError({ name }));
          }
          const keyfile = yield* readKeyfile(fs, name);
          const seed = yield* keystore.decrypt(keyfile, password);
          return {
            seed,
            entry: toAccountInfo(entry, keyfile, data.default),
          };
        }),

      resolveAccount: (flag) =>
        Effect.gen(function* () {
          if (Option.isSome(flag)) {
            const data = yield* readAccountsFile(fs);
            const entry = data.accounts.find((a) => a.name === flag.value);
            if (!entry) {
              return yield* Effect.fail(
                new AccountNotFoundError({ name: flag.value }),
              );
            }
            const keyfile = yield* readKeyfile(fs, entry.name);
            return toAccountInfo(entry, keyfile, data.default);
          }
          const data = yield* readAccountsFile(fs);
          if (!data.default || data.accounts.length === 0) {
            return yield* Effect.fail(new NoAccountsError());
          }
          const entry = data.accounts.find((a) => a.name === data.default);
          if (!entry) {
            return yield* Effect.fail(new NoAccountsError());
          }
          const keyfile = yield* readKeyfile(fs, entry.name);
          return toAccountInfo(entry, keyfile, data.default);
        }),

      nextAutoName: () =>
        Effect.gen(function* () {
          const data = yield* readAccountsFile(fs);
          const existing = new Set(data.accounts.map((a) => a.name));
          let n = 1;
          while (existing.has(`account-${n}`)) {
            n++;
          }
          return `account-${n}`;
        }),
    };
  }),
);
