import {
  bcsSchema,
  SignatureFromInput,
  type TransactionEnvelope,
  type VersionedTransaction,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Effect, Schema } from "effect";
import { signTypedData } from "./signing";

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
