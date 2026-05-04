import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Signer } from "@fastxyz/sdk";
import Db from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  AmbiguousMemberError,
  DatabaseError,
  NotAMemberError,
} from "../../src/errors/index.js";
import { resolveSigner } from "../../src/services/signer-resolver.js";
import {
  type AccountInfo,
  AccountStore,
} from "../../src/services/storage/account.js";
import { DatabaseService } from "../../src/services/storage/database.js";

const SEED = (b: number) => new Uint8Array(32).fill(b);

const makeLayer = () => {
  const dir = mkdtempSync(join(tmpdir(), "fast-cli-resolver-"));
  const dbPath = join(dir, "fast.db");
  const sqlite = new Db(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") });

  const dbServiceLayer = Layer.succeed(DatabaseService, {
    query: <A>(fn: (db: never) => A, message: string) =>
      Effect.try({
        try: () => fn(db as never),
        catch: (cause) => new DatabaseError({ message, cause }),
      }),
  } as never);

  return AccountStore.Default.pipe(Layer.provide(dbServiceLayer));
};

const fastAddressOf = async (seed: Uint8Array): Promise<string> => {
  return new Signer(seed).getFastAddress();
};

describe("resolveSigner", () => {
  it("returns kind=single for a single-signer account", async () => {
    const layer = makeLayer();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const created = yield* accounts.create("alice", SEED(0xaa), null);
        const resolved = yield* resolveSigner({
          account: created as AccountInfo,
          password: null,
        });
        return resolved;
      }).pipe(Effect.provide(layer)),
    );

    expect(result.kind).toBe("single");
    if (result.kind !== "single") throw new Error("unreachable");
    expect(result.account.name).toBe("alice");
    const derivedAddr = await result.signer.getFastAddress();
    expect(derivedAddr).toBe(result.account.fastAddress);
  });

  it("auto-picks a unique local member for multisig", async () => {
    const layer = makeLayer();
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        // bob is NOT created locally — only alice can sign.
        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: [aliceAddr, bobAddr],
            quorum: 2,
            configNonce: "0",
            fastAddress: "fast1xyz",
            network: "testnet",
          },
          true,
        );
        const resolved = yield* resolveSigner({
          account: ms as AccountInfo,
          password: null,
        });
        return resolved;
      }).pipe(Effect.provide(layer)),
    );

    expect(result.kind).toBe("multisig");
    if (result.kind !== "multisig") throw new Error("unreachable");
    expect(result.memberAccount.name).toBe("alice");
    expect(result.account.name).toBe("treasury");
  });

  it("fails AmbiguousMemberError when multiple local members and no --as", async () => {
    const layer = makeLayer();
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        yield* accounts.create("bob", SEED(0xbb), null);
        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: [aliceAddr, bobAddr],
            quorum: 2,
            configNonce: "0",
            fastAddress: "fast1xyz",
            network: "testnet",
          },
          true,
        );
        return yield* resolveSigner({
          account: ms as AccountInfo,
          password: null,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") throw new Error("unreachable");
    const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
    expect(err).toBeInstanceOf(AmbiguousMemberError);
    if (!(err instanceof AmbiguousMemberError)) throw new Error("unreachable");
    expect(err.walletName).toBe("treasury");
    expect([...err.candidates].sort()).toEqual(["alice", "bob"]);
  });

  it("uses --as <name> to disambiguate among multiple local members", async () => {
    const layer = makeLayer();
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        yield* accounts.create("bob", SEED(0xbb), null);
        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: [aliceAddr, bobAddr],
            quorum: 2,
            configNonce: "0",
            fastAddress: "fast1xyz",
            network: "testnet",
          },
          true,
        );
        return yield* resolveSigner({
          account: ms as AccountInfo,
          asMember: "bob",
          password: null,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.kind).toBe("multisig");
    if (result.kind !== "multisig") throw new Error("unreachable");
    expect(result.memberAccount.name).toBe("bob");
  });

  it("fails NotAMemberError when no local account matches any signer", async () => {
    const layer = makeLayer();
    const bobAddr = await fastAddressOf(SEED(0xbb));
    const carolAddr = await fastAddressOf(SEED(0xcc));

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        // alice is local but is NOT a signer of the multisig.
        yield* accounts.create("alice", SEED(0xaa), null);
        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: [bobAddr, carolAddr],
            quorum: 2,
            configNonce: "0",
            fastAddress: "fast1xyz",
            network: "testnet",
          },
          true,
        );
        return yield* resolveSigner({
          account: ms as AccountInfo,
          password: null,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") throw new Error("unreachable");
    const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
    expect(err).toBeInstanceOf(NotAMemberError);
    if (!(err instanceof NotAMemberError)) throw new Error("unreachable");
    expect(err.walletName).toBe("treasury");
  });
});
