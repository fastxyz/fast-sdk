import { Signer, toHex } from "@fastxyz/fast-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { count, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { accounts } from "../../db/schema.js";
import {
  AccountExistsError,
  AccountNotFoundError,
  DatabaseError,
  DefaultAccountError,
  NoDefaultAccountError,
  PasswordRequiredError,
  WrongPasswordError,
} from "../../errors/index.js";
import { loadSeed, storeSeed } from "../crypto.js";
import {
  DatabaseService,
  type DatabaseShape,
  type DrizzleDB,
} from "./database.js";

export interface AccountInfo {
  readonly name: string;
  readonly fastAddress: string;
  readonly evmAddress: string;
  readonly isDefault: boolean;
  readonly encrypted: boolean;
  readonly createdAt: string;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const rowToInfo = (row: typeof accounts.$inferSelect): AccountInfo => ({
  name: row.name,
  fastAddress: row.fastAddress,
  evmAddress: row.evmAddress,
  isDefault: row.isDefault,
  encrypted: row.encrypted,
  createdAt: row.createdAt,
});

const deriveEvmAddress = (seed: Uint8Array): string => {
  const pubkey = secp256k1.getPublicKey(seed, false);
  const hash = keccak_256(pubkey.slice(1));
  return toHex(hash.slice(-20));
};

// ── Raw DB helpers ──────────────────────────────────────────────────────────

const getAccountByName = (db: DrizzleDB, name: string) =>
  db.select().from(accounts).where(eq(accounts.name, name)).get();

const getDefaultAccount = (db: DrizzleDB) =>
  db.select().from(accounts).where(eq(accounts.isDefault, true)).get();

const listAccounts = (db: DrizzleDB) =>
  db.select().from(accounts).orderBy(accounts.createdAt).all();

const countAccounts = (db: DrizzleDB) =>
  db.select({ cnt: count() }).from(accounts).get()!.cnt;

const listAccountNames = (db: DrizzleDB) =>
  db.select({ name: accounts.name }).from(accounts).all();

// ── Effect-level operations ─────────────────────────────────────────────────

const deriveAddresses = (seed: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const signer = new Signer(seed);
      const fastAddress = await signer.getFastAddress();
      const evmAddress = deriveEvmAddress(seed);
      return { fastAddress, evmAddress };
    },
    catch: (cause) =>
      new DatabaseError({ message: "Failed to derive addresses", cause }),
  });

const storeAccount = (
  handle: DatabaseShape,
  name: string,
  seed: Uint8Array,
  password: string | null,
) =>
  Effect.gen(function* () {
    const existing = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to check existing account",
    );
    if (existing) {
      return yield* Effect.fail(new AccountExistsError({ name }));
    }

    const { fastAddress, evmAddress } = yield* deriveAddresses(seed);
    const keyBlob = yield* Effect.tryPromise({
      try: () => storeSeed(seed, password),
      catch: (cause) =>
        new DatabaseError({ message: "Failed to store seed", cause }),
    });

    const isFirst = yield* handle.query(
      (db) => countAccounts(db) === 0,
      "Failed to count accounts",
    );
    const isEncrypted = password !== null;
    const createdAt = new Date().toISOString();

    yield* handle.query(
      (db) =>
        db
          .insert(accounts)
          .values({
            name,
            fastAddress,
            evmAddress,
            encryptedKey: Buffer.from(keyBlob),
            encrypted: isEncrypted,
            isDefault: isFirst,
            createdAt,
          })
          .run(),
      "Failed to store account",
    );

    return {
      name,
      fastAddress,
      evmAddress,
      isDefault: isFirst,
      encrypted: isEncrypted,
      createdAt,
    };
  });

const get = (handle: DatabaseShape, name: string) =>
  Effect.gen(function* () {
    const row = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to get account",
    );
    if (!row) return yield* Effect.fail(new AccountNotFoundError({ name }));
    return rowToInfo(row);
  });

const getDefault = (handle: DatabaseShape) =>
  Effect.gen(function* () {
    const row = yield* handle.query(
      (db) => getDefaultAccount(db),
      "Failed to get default account",
    );
    if (!row) return yield* Effect.fail(new NoDefaultAccountError());
    return rowToInfo(row);
  });

const list = (handle: DatabaseShape) =>
  Effect.map(
    handle.query((db) => listAccounts(db), "Failed to list accounts"),
    (rows) => rows.map(rowToInfo),
  );

const setDefault = (handle: DatabaseShape, name: string) =>
  Effect.gen(function* () {
    const row = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to check account exists",
    );
    if (!row) return yield* Effect.fail(new AccountNotFoundError({ name }));

    yield* handle.query((db) => {
      db.update(accounts)
        .set({ isDefault: false })
        .where(eq(accounts.isDefault, true))
        .run();
      db.update(accounts)
        .set({ isDefault: true })
        .where(eq(accounts.name, name))
        .run();
    }, "Failed to set default account");
  });

const deleteAccount = (handle: DatabaseShape, name: string) =>
  Effect.gen(function* () {
    const row = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to check account exists",
    );
    if (!row) return yield* Effect.fail(new AccountNotFoundError({ name }));

    if (row.isDefault) {
      const total = yield* handle.query(
        (db) => countAccounts(db),
        "Failed to count accounts",
      );
      if (total > 1) {
        return yield* Effect.fail(new DefaultAccountError({ name }));
      }
    }

    yield* handle.query(
      (db) => db.delete(accounts).where(eq(accounts.name, name)).run(),
      "Failed to delete account",
    );
  });

const exportAccount = (
  handle: DatabaseShape,
  name: string,
  password: string | null,
) =>
  Effect.gen(function* () {
    const row = yield* handle.query(
      (db) => getAccountByName(db, name),
      "Failed to read account",
    );
    if (!row) return yield* Effect.fail(new AccountNotFoundError({ name }));

    const seed = yield* Effect.tryPromise({
      try: () =>
        loadSeed(new Uint8Array(row.encryptedKey), password, row.encrypted),
      catch: (cause) => {
        if (cause instanceof WrongPasswordError) return cause;
        if (cause instanceof PasswordRequiredError) return cause;
        return new DatabaseError({
          message: "Failed to load seed",
          cause,
        });
      },
    });

    return { seed, entry: rowToInfo(row) };
  });

const resolveAccount = (handle: DatabaseShape, name: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isNone(name)) {
      return yield* getDefault(handle);
    }

    return yield* get(handle, name.value);
  });

const nextAutoName = (handle: DatabaseShape) =>
  Effect.map(
    handle.query((db) => listAccountNames(db), "Failed to list account names"),
    (rows) => {
      const names = new Set(rows.map((r) => r.name));
      let n = 1;
      while (names.has(`account-${n}`)) n++;
      return `account-${n}`;
    },
  );

// ── Service ─────────────────────────────────────────────────────────────────

const ServiceEffect = Effect.gen(function* () {
  const handle = yield* DatabaseService;

  return {
    list: () => list(handle),
    get: (name: string) => get(handle, name),
    getDefault: () => getDefault(handle),
    create: (name: string, seed: Uint8Array, password: string | null) =>
      storeAccount(handle, name, seed, password),
    import: (name: string, seed: Uint8Array, password: string | null) =>
      storeAccount(handle, name, seed, password),
    setDefault: (name: string) => setDefault(handle, name),
    delete: (name: string) => deleteAccount(handle, name),
    export: (name: string, password: string | null) =>
      exportAccount(handle, name, password),
    resolveAccount: (flag: Option.Option<string>) =>
      resolveAccount(handle, flag),
    nextAutoName: () => nextAutoName(handle),
  };
});

export class AccountStore extends Effect.Service<AccountStore>()(
  "AccountStore",
  { effect: ServiceEffect },
) {}
