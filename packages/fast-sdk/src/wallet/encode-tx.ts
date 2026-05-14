import {
  bcsSchema,
  type VersionedTransaction,
  VersionedTransactionFromBcs,
} from "@fastxyz/schema";
import { Schema } from "effect";
import { domainEncode } from "../interface/encode";

/** BCS-serialize a VersionedTransaction and prepend the "VersionedTransaction::" domain prefix, producing the final bytes a popup wallet signs with raw Ed25519. */
export async function encodeTxForWalletSigning(
  transaction: VersionedTransaction,
): Promise<Uint8Array> {
  const bcsEncoded = Schema.encodeSync(VersionedTransactionFromBcs)(transaction);
  return domainEncode(bcsSchema.VersionedTransaction, bcsEncoded);
}
