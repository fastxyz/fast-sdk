import {
  bcsSchema,
  SignatureFromInput,
  type TransactionEnvelope,
  type VersionedTransaction,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Effect, Schema } from "effect";
import { signTypedData, verifyTypedData } from "./signing";

/** Sign a VersionedTransaction with an Ed25519 private key. */
export const signVersionedTransaction = (
  privateKey: Uint8Array,
  transaction: VersionedTransaction,
) =>
  Effect.gen(function* () {
    const bcsEncoded = yield* Schema.encode(VersionedTransactionFromBcs)(
      transaction,
    );
    return yield* signTypedData(
      privateKey,
      bcsSchema.VersionedTransaction,
      bcsEncoded,
    );
  });

/** Verify a VersionedTransaction signature against an Ed25519 public key. */
export const verifyVersionedTransactionSignature = (
  signature: Uint8Array,
  transaction: VersionedTransaction,
  publicKey: Uint8Array,
) =>
  Effect.gen(function* () {
    const bcsEncoded = yield* Schema.encode(VersionedTransactionFromBcs)(
      transaction,
    );
    return yield* verifyTypedData(
      signature,
      bcsSchema.VersionedTransaction,
      bcsEncoded,
      publicKey,
    );
  });

/** Build a signed TransactionEnvelope from a VersionedTransaction. */
export const buildSignedEnvelope = (
  privateKey: Uint8Array,
  transaction: VersionedTransaction,
): Effect.Effect<TransactionEnvelope, unknown> =>
  Effect.gen(function* () {
    const rawSig = yield* signVersionedTransaction(privateKey, transaction);
    const signature = yield* Schema.decodeUnknown(SignatureFromInput)(rawSig);

    return {
      transaction,
      signature: { type: "Signature" as const, value: signature },
    };
  });
