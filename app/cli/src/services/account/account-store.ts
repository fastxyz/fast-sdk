import { Signer, toHex } from "@fastxyz/fast-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { Context, Effect, Layer, Option } from "effect";
import {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoAccountsError,
  StorageError,
  WrongPasswordError,
} from "../../errors/index.js";
import { encryptSeed, decryptSeed } from "../crypto.js";
import { DatabaseService } from "../database.js";

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

interface AccountRow {
  name: string;
  fast_address: string;
  evm_address: string;
  encrypted_key: Buffer;
  is_default: number;
  created_at: string;
}

const rowToInfo = (row: AccountRow): AccountInfo => ({
  name: row.name,
  fastAddress: row.fast_address,
  evmAddress: row.evm_address,
  isDefault: row.is_default === 1,
  createdAt: row.created_at,
});

const deriveEvmAddress = (seed: Uint8Array): string => {
  const pubkey = secp256k1.getPublicKey(seed, false);
  const hash = keccak_256(pubkey.slice(1));
  return toHex(hash.slice(-20));
};

const deriveAddresses = (seed: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const signer = new Signer(seed);
      const fastAddress = await signer.getFastAddress();
      const evmAddress = deriveEvmAddress(seed);
      return { fastAddress, evmAddress };
    },
    catch: (cause) =>
      new StorageError({ message: "Failed to derive addresses", cause }),
  });

export const AccountStoreLive = Layer.effect(
  AccountStore,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;

    const stmts = {
      listAll: db.prepare<[], AccountRow>("SELECT * FROM accounts ORDER BY created_at"),
      getByName: db.prepare<[string], AccountRow>("SELECT * FROM accounts WHERE name = ?"),
      getDefault: db.prepare<[], AccountRow>("SELECT * FROM accounts WHERE is_default = 1"),
      countAll: db.prepare<[], { cnt: number }>("SELECT COUNT(*) as cnt FROM accounts"),
      insert: db.prepare(
        "INSERT INTO accounts (name, fast_address, evm_address, encrypted_key, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ),
      clearDefault: db.prepare("UPDATE accounts SET is_default = 0 WHERE is_default = 1"),
      setDefault: db.prepare("UPDATE accounts SET is_default = 1 WHERE name = ?"),
      deleteByName: db.prepare("DELETE FROM accounts WHERE name = ?"),
      allNames: db.prepare<[], { name: string }>("SELECT name FROM accounts"),
    };

    const storeAccount = (
      name: string,
      seed: Uint8Array,
      password: string,
    ): Effect.Effect<AccountInfo, AccountExistsError | StorageError> =>
      Effect.gen(function* () {
        const existing = stmts.getByName.get(name);
        if (existing) {
          return yield* Effect.fail(new AccountExistsError({ name }));
        }

        const { fastAddress, evmAddress } = yield* deriveAddresses(seed);
        const encrypted = yield* Effect.tryPromise({
          try: () => encryptSeed(seed, password),
          catch: (cause) =>
            new StorageError({ message: "Failed to encrypt seed", cause }),
        });

        const isFirst = stmts.countAll.get()!.cnt === 0;
        const createdAt = new Date().toISOString();

        db.transaction(() => {
          stmts.insert.run(
            name,
            fastAddress,
            evmAddress,
            Buffer.from(encrypted),
            isFirst ? 1 : 0,
            createdAt,
          );
        })();

        return {
          name,
          fastAddress,
          evmAddress,
          isDefault: isFirst,
          createdAt,
        };
      });

    return {
      list: () =>
        Effect.try({
          try: () => stmts.listAll.all().map(rowToInfo),
          catch: (cause) =>
            new StorageError({ message: "Failed to list accounts", cause }),
        }),

      get: (name) =>
        Effect.try({
          try: () => {
            const row = stmts.getByName.get(name);
            if (!row) throw new AccountNotFoundError({ name });
            return rowToInfo(row);
          },
          catch: (e) =>
            e instanceof AccountNotFoundError
              ? e
              : new StorageError({ message: "Failed to get account", cause: e }),
        }),

      getDefault: () =>
        Effect.try({
          try: () => {
            const row = stmts.getDefault.get();
            if (!row) throw new NoAccountsError();
            return rowToInfo(row);
          },
          catch: (e) =>
            e instanceof NoAccountsError
              ? e
              : new StorageError({ message: "Failed to get default account", cause: e }),
        }),

      create: (name, seed, password) => storeAccount(name, seed, password),
      import_: (name, seed, password) => storeAccount(name, seed, password),

      setDefault: (name) =>
        Effect.try({
          try: () => {
            const row = stmts.getByName.get(name);
            if (!row) throw new AccountNotFoundError({ name });
            db.transaction(() => {
              stmts.clearDefault.run();
              stmts.setDefault.run(name);
            })();
          },
          catch: (e) =>
            e instanceof AccountNotFoundError
              ? e
              : new StorageError({ message: "Failed to set default", cause: e }),
        }),

      delete_: (name) =>
        Effect.try({
          try: () => {
            const row = stmts.getByName.get(name);
            if (!row) throw new AccountNotFoundError({ name });
            if (row.is_default === 1 && stmts.countAll.get()!.cnt > 1) {
              throw new DefaultAccountError({ name });
            }
            stmts.deleteByName.run(name);
          },
          catch: (e) =>
            e instanceof AccountNotFoundError || e instanceof DefaultAccountError
              ? e
              : new StorageError({ message: "Failed to delete account", cause: e }),
        }),

      export_: (name, password) =>
        Effect.gen(function* () {
          const row = yield* Effect.try({
            try: () => {
              const r = stmts.getByName.get(name);
              if (!r) throw new AccountNotFoundError({ name });
              return r;
            },
            catch: (e) =>
              e instanceof AccountNotFoundError
                ? e
                : new StorageError({ message: "Failed to read account", cause: e }),
          });

          const seed = yield* Effect.tryPromise({
            try: () => decryptSeed(new Uint8Array(row.encrypted_key), password),
            catch: (cause) => {
              if (cause instanceof WrongPasswordError) return cause;
              return new StorageError({ message: "Failed to decrypt seed", cause });
            },
          });

          return { seed, entry: rowToInfo(row) };
        }),

      resolveAccount: (flag) =>
        Effect.gen(function* () {
          if (Option.isSome(flag)) {
            const row = stmts.getByName.get(flag.value);
            if (!row) {
              return yield* Effect.fail(
                new AccountNotFoundError({ name: flag.value }),
              );
            }
            return rowToInfo(row);
          }
          const row = stmts.getDefault.get();
          if (!row) {
            return yield* Effect.fail(new NoAccountsError());
          }
          return rowToInfo(row);
        }),

      nextAutoName: () =>
        Effect.try({
          try: () => {
            const names = new Set(stmts.allNames.all().map((r) => r.name));
            let n = 1;
            while (names.has(`account-${n}`)) n++;
            return `account-${n}`;
          },
          catch: (cause) =>
            new StorageError({ message: "Failed to generate account name", cause }),
        }),
    };
  }),
);
