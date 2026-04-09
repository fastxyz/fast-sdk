import {
  bcsSchema,
  SignatureFromInput,
  type TransactionEnvelope,
  type VersionedTransaction,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Effect, Schema } from "effect";
import { signTypedData } from "./signing";

/** Build a signed TransactionEnvelope from a VersionedTransaction. */
export const buildSignedEnvelope = (
  privateKey: Uint8Array,
  transaction: VersionedTransaction,
): Effect.Effect<TransactionEnvelope, unknown> =>
  Effect.gen(function* () {
    const bcsEncoded = yield* Schema.encode(VersionedTransactionFromBcs)(
      transaction,
    );
    const rawSig = yield* signTypedData(
      privateKey,
      bcsSchema.VersionedTransaction,
      bcsEncoded,
    );
    const signature = yield* Schema.decodeUnknown(SignatureFromInput)(rawSig);

    return {
      transaction,
      signature: { type: "Signature" as const, value: signature },
    };
  });
