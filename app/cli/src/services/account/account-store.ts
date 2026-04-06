import { Signer, toHex } from "@fastxyz/fast-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { eq, count } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { accounts } from "../../db/schema.js";
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

const rowToInfo = (row: typeof accounts.$inferSelect): AccountInfo => ({
  name: row.name,
  fastAddress: row.fastAddress,
  evmAddress: row.evmAddress,
  isDefault: row.isDefault,
  createdAt: row.createdAt,
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

    const storeAccount = (
      name: string,
      seed: Uint8Array,
      password: string,
    ): Effect.Effect<AccountInfo, AccountExistsError | StorageError> =>
      Effect.gen(function* () {
        const existing = db.select().from(accounts).where(eq(accounts.name, name)).get();
        if (existing) {
          return yield* Effect.fail(new AccountExistsError({ name }));
        }

        const { fastAddress, evmAddress } = yield* deriveAddresses(seed);
        const encrypted = yield* Effect.tryPromise({
          try: () => encryptSeed(seed, password),
          catch: (cause) =>
            new StorageError({ message: "Failed to encrypt seed", cause }),
        });

        const isFirst = db.select({ cnt: count() }).from(accounts).get()!.cnt === 0;
        const createdAt = new Date().toISOString();

        db.insert(accounts).values({
          name,
          fastAddress,
          evmAddress,
          encryptedKey: Buffer.from(encrypted),
          isDefault: isFirst,
          createdAt,
        }).run();

        return { name, fastAddress, evmAddress, isDefault: isFirst, createdAt };
      });

    return {
      list: () =>
        Effect.try({
          try: () =>
            db.select().from(accounts).orderBy(accounts.createdAt).all().map(rowToInfo),
          catch: (cause) =>
            new StorageError({ message: "Failed to list accounts", cause }),
        }),

      get: (name) =>
        Effect.try({
          try: () => {
            const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
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
            const row = db.select().from(accounts).where(eq(accounts.isDefault, true)).get();
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
            const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
            if (!row) throw new AccountNotFoundError({ name });
            db.update(accounts).set({ isDefault: false }).where(eq(accounts.isDefault, true)).run();
            db.update(accounts).set({ isDefault: true }).where(eq(accounts.name, name)).run();
          },
          catch: (e) =>
            e instanceof AccountNotFoundError
              ? e
              : new StorageError({ message: "Failed to set default", cause: e }),
        }),

      delete_: (name) =>
        Effect.try({
          try: () => {
            const row = db.select().from(accounts).where(eq(accounts.name, name)).get();
            if (!row) throw new AccountNotFoundError({ name });
            if (row.isDefault && db.select({ cnt: count() }).from(accounts).get()!.cnt > 1) {
              throw new DefaultAccountError({ name });
            }
            db.delete(accounts).where(eq(accounts.name, name)).run();
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
              const r = db.select().from(accounts).where(eq(accounts.name, name)).get();
              if (!r) throw new AccountNotFoundError({ name });
              return r;
            },
            catch: (e) =>
              e instanceof AccountNotFoundError
                ? e
                : new StorageError({ message: "Failed to read account", cause: e }),
          });

          const seed = yield* Effect.tryPromise({
            try: () => decryptSeed(new Uint8Array(row.encryptedKey), password),
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
            const row = db.select().from(accounts).where(eq(accounts.name, flag.value)).get();
            if (!row) {
              return yield* Effect.fail(new AccountNotFoundError({ name: flag.value }));
            }
            return rowToInfo(row);
          }
          const row = db.select().from(accounts).where(eq(accounts.isDefault, true)).get();
          if (!row) {
            return yield* Effect.fail(new NoAccountsError());
          }
          return rowToInfo(row);
        }),

      nextAutoName: () =>
        Effect.try({
          try: () => {
            const rows = db.select({ name: accounts.name }).from(accounts).all();
            const names = new Set(rows.map((r) => r.name));
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
