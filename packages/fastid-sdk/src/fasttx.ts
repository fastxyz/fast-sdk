import { hashHex } from "@fastxyz/sdk";
import {
  TransactionCertificateFromRest,
  VersionedTransactionFromBcs,
  bcsSchema,
} from "@fastxyz/schema";
import { Schema } from "effect";

export interface Registration {
  txIdHex: string;
  nonceDecimal: string;
  network: string;
}

export type DomainVersionedTransaction =
  typeof VersionedTransactionFromBcs.Type;

export async function txIdFromDomainTransaction(
  transaction: DomainVersionedTransaction,
): Promise<string> {
  const bcsInput = Schema.encodeSync(VersionedTransactionFromBcs)(transaction);
  const prefixedHex = await hashHex(bcsSchema.VersionedTransaction, bcsInput);
  return prefixedHex.replace(/^0x/i, "").toLowerCase();
}

export async function certToRegistration(cert: unknown): Promise<Registration> {
  let decoded: typeof TransactionCertificateFromRest.Type;
  try {
    decoded = Schema.decodeUnknownSync(TransactionCertificateFromRest)(cert);
  } catch (error) {
    throw new Error(
      `Malformed transaction certificate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const transaction = decoded.envelope.transaction;
  let txIdHex: string;
  try {
    txIdHex = await txIdFromDomainTransaction(transaction);
  } catch (error) {
    throw new Error(
      `Could not compute tx_id from certificate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const value = (
    transaction as {
      value?: { nonce?: bigint; networkId?: string; network?: string };
    }
  ).value;
  if (!value || value.nonce === undefined) {
    throw new Error(
      "Transaction certificate is missing a nonce; unrecognized transaction shape.",
    );
  }
  return {
    txIdHex,
    nonceDecimal: value.nonce.toString(),
    network: value.networkId ?? value.network ?? "",
  };
}
