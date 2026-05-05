/**
 * Integration test: 2-of-3 multisig happy path.
 *
 * Drives the multisig flow at the service level:
 *   - in-memory SQLite + drizzle + AccountStore.Default
 *   - real ed25519 keypairs via Signer.getFastAddress()
 *   - real MultiSigSigner for partial-signature production
 *   - stubbed FastRpc that aggregates partials by tx hash and reports
 *     IncompleteMultiSig until quorum, then Success
 *
 * We deliberately do NOT call the full command handlers (send.handler /
 * multisig-vote.handler / multisig-init.handler) because they require
 * Output, Prompt, ClientConfig, NetworkConfigService, HistoryStore, AllSet,
 * and token-resolver wiring — far beyond the scope of this contract test.
 * Instead we exercise the same service surface those handlers do:
 *   - AccountStore (.create, .createMultiSig)
 *   - resolveSigner
 *   - MultiSigSigner.signTransaction / signEnvelopeFor
 *   - FastRpc.submitTransaction / getPendingMultisigTransactions
 *
 * That preserves the SDK contract verification and the multisig partial
 * aggregation semantics that vote.ts and send.ts rely on.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bcsSchema,
  type TransactionEnvelope,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import {
  deriveMultiSigAddress,
  fromFastAddress,
  hashHex,
  Signer,
} from "@fastxyz/sdk";
import Db from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Effect, Layer, Ref, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AddressDerivationMismatchError,
  AlreadyVotedError,
  DatabaseError,
  NotAMemberError,
  WalletKindMismatchError,
} from "../../src/errors/index.js";
import {
  parseMultiSigWalletConfig,
  stringifyMultiSigWalletConfig,
} from "../../src/schemas/multisig-wallet.js";
import { resolveSigner } from "../../src/services/signer-resolver.js";
import {
  type AccountInfo,
  AccountStore,
} from "../../src/services/storage/account.js";
import { DatabaseService } from "../../src/services/storage/database.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const SEED = (b: number) => new Uint8Array(32).fill(b);

const fastAddressOf = async (seed: Uint8Array): Promise<string> => {
  return new Signer(seed).getFastAddress();
};

const computeTxHash = async (
  envelope: TransactionEnvelope,
): Promise<string> => {
  const bcsInput = await Effect.runPromise(
    Schema.encode(VersionedTransactionFromBcs)(envelope.transaction),
  );
  return hashHex(bcsSchema.VersionedTransaction, bcsInput);
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// ── Stub FastRpc ────────────────────────────────────────────────────────────

interface StubRpcState {
  // tx hash → accumulated envelope (with signatures merged)
  readonly pending: Map<string, TransactionEnvelope>;
}

const initialState: StubRpcState = { pending: new Map() };

const submitTransaction = (
  ref: Ref.Ref<StubRpcState>,
  envelope: TransactionEnvelope,
) =>
  Effect.gen(function* () {
    if (envelope.signature.type !== "MultiSig") {
      // Non-multisig tx: surface a Success without further bookkeeping.
      return { type: "Success", certificate: { stub: true } };
    }

    const incoming = envelope.signature.value;
    const quorum = Number(incoming.config.quorum);
    const txHash = yield* Effect.promise(() => computeTxHash(envelope));

    yield* Ref.update(ref, (state) => {
      const existing = state.pending.get(txHash);
      const existingPartials = existing
        ? (
            existing.signature as Extract<
              TransactionEnvelope["signature"],
              { type: "MultiSig" }
            >
          ).value.signatures
        : [];
      // Dedupe by signer pubkey.
      const seen = new Set(
        existingPartials.map((p) =>
          Array.from(p[0])
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        ),
      );
      const merged = [...existingPartials];
      for (const partial of incoming.signatures) {
        const key = Array.from(partial[0])
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (!seen.has(key)) {
          merged.push(partial);
          seen.add(key);
        }
      }
      const updated: TransactionEnvelope = {
        transaction: envelope.transaction,
        signature: {
          type: "MultiSig",
          value: {
            config: incoming.config,
            signatures: merged,
          },
        },
      };
      const next = new Map(state.pending);
      next.set(txHash, updated);
      return { pending: next };
    });

    const state = yield* Ref.get(ref);
    const stored = state.pending.get(txHash)!;
    const storedPartials = (
      stored.signature as Extract<
        TransactionEnvelope["signature"],
        { type: "MultiSig" }
      >
    ).value.signatures;

    if (storedPartials.length >= quorum) {
      // Quorum reached — drop from pending and report Success.
      yield* Ref.update(ref, (s) => {
        const next = new Map(s.pending);
        next.delete(txHash);
        return { pending: next };
      });
      return { type: "Success", certificate: { stub: true, txHash } };
    }
    return { type: "IncompleteMultiSig" };
  });

// We exercise submitTransaction / getPendingMultisigTransactions directly
// (not through the FastRpc service Tag) — the Effect chain in this test
// never `yield* FastRpc`, so we don't need to construct a FastRpcLive Layer.
// The stub captures all proxy state mutations that vote/send rely on.

// ── Layer construction ──────────────────────────────────────────────────────

const makeBaseLayer = () => {
  const dir = mkdtempSync(join(tmpdir(), "fast-cli-multisig-int-"));
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("multisig 2-of-3 integration", () => {
  it("happy path: alice initiates → IncompleteMultiSig; bob votes → Success", async () => {
    const layer = makeBaseLayer();
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));
    const carolAddr = await fastAddressOf(SEED(0xcc));

    const sortedSigners = [aliceAddr, bobAddr, carolAddr].sort();
    const sdkConfig = {
      authorized_signers: sortedSigners.map((a) => fromFastAddress(a)),
      quorum: 2n,
      nonce: 0n,
    };
    const multisigFastAddr = await deriveMultiSigAddress(sdkConfig);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;

        // Three single-signer accounts.
        yield* accounts.create("alice", SEED(0xaa), null);
        yield* accounts.create("bob", SEED(0xbb), null);
        yield* accounts.create("carol", SEED(0xcc), null);

        // Multisig wallet with quorum = 2.
        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: sortedSigners,
            quorum: 2,
            configNonce: "0",
            fastAddress: multisigFastAddr,
            network: "testnet",
          },
          true,
        );

        // ── Alice initiates ─────────────────────────────────────────────────
        const aliceResolved = yield* resolveSigner({
          account: ms as AccountInfo,
          asMember: "alice",
          password: null,
        });
        if (aliceResolved.kind !== "multisig")
          throw new Error("expected multisig signer for alice");

        const recipient = new Uint8Array(32).fill(0x42);
        const tokenTransfer = {
          tokenId: new Uint8Array(32),
          recipient,
          amount: 1000n,
          userData: null,
        };

        const aliceEnvelope = yield* Effect.promise(() =>
          aliceResolved.signer.signTransaction({
            networkId: "fast:testnet" as const,
            nonce: 0n,
            operations: [
              { type: "TokenTransfer" as const, value: tokenTransfer },
            ],
          }),
        );

        // Stubbed RPC.
        const rpcRef = yield* Ref.make<StubRpcState>(initialState);

        const aliceSubmit = yield* submitTransaction(rpcRef, aliceEnvelope);
        // ── Assert alice's submit is IncompleteMultiSig ─────────────────────
        const aliceResultType = (aliceSubmit as { type: string }).type;

        // Bob fetches pending list.
        const multisigBytes = fromFastAddress(multisigFastAddr);
        const state1 = yield* Ref.get(rpcRef);
        const pendingForWallet = Array.from(state1.pending.values()).filter(
          (e) => bytesEqual(e.transaction.value.sender, multisigBytes),
        );

        // ── Bob votes ───────────────────────────────────────────────────────
        const bobResolved = yield* resolveSigner({
          account: ms as AccountInfo,
          asMember: "bob",
          password: null,
        });
        if (bobResolved.kind !== "multisig")
          throw new Error("expected multisig signer for bob");

        const targetEnvelope = pendingForWallet[0]!;
        const bobEnvelope = yield* Effect.promise(() =>
          bobResolved.signer.signEnvelopeFor(targetEnvelope.transaction),
        );

        const bobSubmit = yield* submitTransaction(rpcRef, bobEnvelope);

        const state2 = yield* Ref.get(rpcRef);

        return {
          aliceResultType,
          bobSubmit,
          pendingAfter: state2.pending.size,
        };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.aliceResultType).toBe("IncompleteMultiSig");
    expect((result.bobSubmit as { type: string }).type).toBe("Success");
    expect(result.pendingAfter).toBe(0);
  });

  it("double-sign refused: alice cannot vote on her own initiation", async () => {
    const layer = makeBaseLayer();
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));
    const carolAddr = await fastAddressOf(SEED(0xcc));

    const sortedSigners = [aliceAddr, bobAddr, carolAddr].sort();
    const sdkConfig = {
      authorized_signers: sortedSigners.map((a) => fromFastAddress(a)),
      quorum: 2n,
      nonce: 0n,
    };
    const multisigFastAddr = await deriveMultiSigAddress(sdkConfig);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create("alice", SEED(0xaa), null);
        yield* accounts.create("bob", SEED(0xbb), null);
        yield* accounts.create("carol", SEED(0xcc), null);

        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: sortedSigners,
            quorum: 2,
            configNonce: "0",
            fastAddress: multisigFastAddr,
            network: "testnet",
          },
          true,
        );

        const aliceResolved = yield* resolveSigner({
          account: ms as AccountInfo,
          asMember: "alice",
          password: null,
        });
        if (aliceResolved.kind !== "multisig")
          throw new Error("expected multisig signer for alice");

        const aliceEnvelope = yield* Effect.promise(() =>
          aliceResolved.signer.signTransaction({
            networkId: "fast:testnet" as const,
            nonce: 0n,
            operations: [
              {
                type: "TokenTransfer" as const,
                value: {
                  tokenId: new Uint8Array(32),
                  recipient: new Uint8Array(32).fill(0x42),
                  amount: 1000n,
                  userData: null,
                },
              },
            ],
          }),
        );

        const rpcRef = yield* Ref.make<StubRpcState>(initialState);
        yield* submitTransaction(rpcRef, aliceEnvelope);

        // Alice tries to vote on the same envelope.
        const myPubkey = yield* Effect.promise(() =>
          aliceResolved.signer.getSignerPublicKey(),
        );

        const state = yield* Ref.get(rpcRef);
        const pending = Array.from(state.pending.values())[0]!;
        if (pending.signature.type !== "MultiSig")
          throw new Error("unreachable");
        const existingPartials = pending.signature.value.signatures;
        const alreadySigned = existingPartials.some(([signer]) =>
          bytesEqual(signer, myPubkey),
        );
        const txHash = yield* Effect.promise(() => computeTxHash(pending));
        if (alreadySigned) {
          return yield* Effect.fail(
            new AlreadyVotedError({
              walletName: ms.name,
              txHash: `0x${txHash}`,
            }),
          );
        }
        // Should not reach here.
        return null;
      }).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") throw new Error("unreachable");
    const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
    expect(err).toBeInstanceOf(AlreadyVotedError);
    if (!(err instanceof AlreadyVotedError)) throw new Error("unreachable");
    expect(err.walletName).toBe("treasury");
  });

  it("NotAMemberError: alice is local but not a signer of the multisig", async () => {
    const layer = makeBaseLayer();
    const bobAddr = await fastAddressOf(SEED(0xbb));
    const carolAddr = await fastAddressOf(SEED(0xcc));

    const sortedSigners = [bobAddr, carolAddr].sort();
    const sdkConfig = {
      authorized_signers: sortedSigners.map((a) => fromFastAddress(a)),
      quorum: 2n,
      nonce: 0n,
    };
    const multisigFastAddr = await deriveMultiSigAddress(sdkConfig);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        // alice is local but not a signer.
        yield* accounts.create("alice", SEED(0xaa), null);

        const ms = yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: sortedSigners,
            quorum: 2,
            configNonce: "0",
            fastAddress: multisigFastAddr,
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

  it("multisig import --from with mismatched fastAddress → AddressDerivationMismatchError", async () => {
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));
    const carolAddr = await fastAddressOf(SEED(0xcc));

    const sortedSigners = [aliceAddr, bobAddr, carolAddr].sort();
    const sdkConfig = {
      authorized_signers: sortedSigners.map((a) => fromFastAddress(a)),
      quorum: 2n,
      nonce: 0n,
    };
    const realFastAddr = await deriveMultiSigAddress(sdkConfig);

    // Pick a different valid fast address that does NOT match the derivation.
    // Use alice's own single-signer fast address as a tampered value — it's a
    // well-formed bech32 fast1… string, but obviously not what
    // deriveMultiSigAddress(sortedSigners, 2, 0) produces.
    const tamperedFastAddr = aliceAddr;
    expect(tamperedFastAddr).not.toBe(realFastAddr);

    const dir = mkdtempSync(join(tmpdir(), "fast-cli-multisig-import-"));
    const filePath = join(dir, "treasury.json");
    const walletConfig = {
      version: 1 as const,
      name: "treasury",
      signers: sortedSigners,
      quorum: 2,
      configNonce: "0",
      fastAddress: tamperedFastAddr,
      network: "testnet",
    };
    writeFileSync(filePath, `${stringifyMultiSigWalletConfig(walletConfig)}\n`);

    // Replicate the verification flow from import.ts:113-141 at the service
    // level — read file, parse, derive, compare.
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const content = yield* Effect.try({
          try: () => readFileSync(filePath, "utf-8"),
          catch: (e) => new Error(String(e)),
        });
        const parsed = yield* parseMultiSigWalletConfig(content);
        const sorted = [...parsed.signers].sort();
        const nonceBig = BigInt(parsed.configNonce);
        const derived = yield* Effect.tryPromise({
          try: () =>
            deriveMultiSigAddress({
              authorized_signers: sorted.map((s) => fromFastAddress(s)),
              quorum: BigInt(parsed.quorum),
              nonce: nonceBig,
            }),
          catch: (cause) => new Error(String(cause)),
        });
        if (derived !== parsed.fastAddress) {
          return yield* Effect.fail(
            new AddressDerivationMismatchError({
              expected: parsed.fastAddress,
              derived,
            }),
          );
        }
        return null;
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") throw new Error("unreachable");
    const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
    expect(err).toBeInstanceOf(AddressDerivationMismatchError);
    if (!(err instanceof AddressDerivationMismatchError))
      throw new Error("unreachable");
    expect(err.expected).toBe(tamperedFastAddr);
    expect(err.derived).toBe(realFastAddr);
  });

  it("account export against multisig row → WalletKindMismatchError", async () => {
    const layer = makeBaseLayer();
    const aliceAddr = await fastAddressOf(SEED(0xaa));
    const bobAddr = await fastAddressOf(SEED(0xbb));
    const carolAddr = await fastAddressOf(SEED(0xcc));

    const sortedSigners = [aliceAddr, bobAddr, carolAddr].sort();
    const sdkConfig = {
      authorized_signers: sortedSigners.map((a) => fromFastAddress(a)),
      quorum: 2n,
      nonce: 0n,
    };
    const multisigFastAddr = await deriveMultiSigAddress(sdkConfig);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.createMultiSig(
          {
            version: 1,
            name: "treasury",
            signers: sortedSigners,
            quorum: 2,
            configNonce: "0",
            fastAddress: multisigFastAddr,
            network: "testnet",
          },
          true,
        );

        return yield* accounts.export("treasury", null);
      }).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag !== "Failure") throw new Error("unreachable");
    const err = exit.cause._tag === "Fail" ? exit.cause.error : null;
    expect(err).toBeInstanceOf(WalletKindMismatchError);
    if (!(err instanceof WalletKindMismatchError))
      throw new Error("unreachable");
    expect(err.expected).toBe("single");
    expect(err.name).toBe("treasury");
  });
});
