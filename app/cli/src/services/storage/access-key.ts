import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { accessKeys } from "../../db/schema.js";
import { DatabaseError } from "../../errors/index.js";
import { storeSeed } from "../crypto.js";
import {
  DatabaseService,
  type DatabaseShape,
  type DrizzleDB,
} from "./database.js";

export interface StoredAccessKeyInfo {
  readonly accessKeyId: string;
  readonly ownerAccountName: string;
  readonly ownerFastAddress: string;
  readonly network: string;
  readonly delegatePublicKey: string;
  readonly encrypted: boolean;
  readonly label: string | null;
  readonly clientId: string;
  readonly createdAt: string;
}

export interface StoreAccessKeyInput {
  readonly accessKeyId: string;
  readonly ownerAccountName: string;
  readonly ownerFastAddress: string;
  readonly network: string;
  readonly delegatePublicKey: string;
  readonly privateKey: Uint8Array;
  readonly password: string | null;
  readonly label: string | null;
  readonly clientId: string;
  readonly createdAt: string;
}

const rowToInfo = (row: typeof accessKeys.$inferSelect): StoredAccessKeyInfo => ({
  accessKeyId: row.accessKeyId,
  ownerAccountName: row.ownerAccountName,
  ownerFastAddress: row.ownerFastAddress,
  network: row.network,
  delegatePublicKey: row.delegatePublicKey,
  encrypted: row.encrypted,
  label: row.label,
  clientId: row.clientId,
  createdAt: row.createdAt,
});

const listByOwner = (db: DrizzleDB, ownerFastAddress: string, network: string) =>
  db
    .select()
    .from(accessKeys)
    .where(
      and(
        eq(accessKeys.ownerFastAddress, ownerFastAddress),
        eq(accessKeys.network, network),
      ),
    )
    .orderBy(accessKeys.createdAt)
    .all();

const getById = (db: DrizzleDB, accessKeyId: string) =>
  db.select().from(accessKeys).where(eq(accessKeys.accessKeyId, accessKeyId)).get();

const put = (
  handle: DatabaseShape,
  input: StoreAccessKeyInput,
) =>
  Effect.gen(function* () {
    const encryptedPrivateKey = yield* Effect.tryPromise({
      try: () => storeSeed(input.privateKey, input.password),
      catch: (cause) =>
        new DatabaseError({ message: "Failed to encrypt access key material", cause }),
    });

    yield* handle.query(
      (db) =>
        db
          .insert(accessKeys)
          .values({
            accessKeyId: input.accessKeyId,
            ownerAccountName: input.ownerAccountName,
            ownerFastAddress: input.ownerFastAddress,
            network: input.network,
            delegatePublicKey: input.delegatePublicKey,
            encryptedPrivateKey: Buffer.from(encryptedPrivateKey),
            encrypted: input.password !== null,
            label: input.label,
            clientId: input.clientId,
            createdAt: input.createdAt,
          })
          .onConflictDoUpdate({
            target: accessKeys.accessKeyId,
            set: {
              ownerAccountName: input.ownerAccountName,
              ownerFastAddress: input.ownerFastAddress,
              network: input.network,
              delegatePublicKey: input.delegatePublicKey,
              encryptedPrivateKey: Buffer.from(encryptedPrivateKey),
              encrypted: input.password !== null,
              label: input.label,
              clientId: input.clientId,
              createdAt: input.createdAt,
            },
          })
          .run(),
      "Failed to store access key material",
    );
  });

const remove = (handle: DatabaseShape, accessKeyId: string) =>
  handle.query(
    (db) => db.delete(accessKeys).where(eq(accessKeys.accessKeyId, accessKeyId)).run(),
    "Failed to remove access key material",
  );

const list = (handle: DatabaseShape, ownerFastAddress: string, network: string) =>
  Effect.map(
    handle.query(
      (db) => listByOwner(db, ownerFastAddress, network),
      "Failed to list access keys",
    ),
    (rows) => rows.map(rowToInfo),
  );

const has = (handle: DatabaseShape, accessKeyId: string) =>
  Effect.map(
    handle.query((db) => getById(db, accessKeyId), "Failed to load access key"),
    (row) => row !== undefined,
  );

const ServiceEffect = Effect.gen(function* () {
  const handle = yield* DatabaseService;

  return {
    put: (input: StoreAccessKeyInput) => put(handle, input),
    remove: (accessKeyId: string) => remove(handle, accessKeyId),
    list: (ownerFastAddress: string, network: string) =>
      list(handle, ownerFastAddress, network),
    has: (accessKeyId: string) => has(handle, accessKeyId),
  };
});

export class AccessKeyStore extends Effect.Service<AccessKeyStore>()(
  "AccessKeyStore",
  { effect: ServiceEffect },
) {}
