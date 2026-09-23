// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { encodeTxForWalletSigning } from "@fastxyz/sdk/wallet";
import { TransactionCertificateFromRest } from "@fastxyz/schema";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { Schema } from "effect";
import { JSONParse, JSONStringify } from "json-with-bigint";

import { AttestationV3Error, decodeAttestationV3, type ArtifactAttestationV3 } from "./attestation.js";
import { assertLowerHex, bytesToHex, hexToBytes } from "./bytes.js";
import { deriveTransactionEvidence } from "./transactions.js";
import type { SignNetwork } from "../types.js";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => sha512(ed.etc.concatBytes(...messages));

export const SETTLEMENT_TRUST = "configured_proxy_mvp" as const;
const MAX_CERTIFICATE_BYTES = 1024 * 1024;
const MAX_CERTIFICATE_DEPTH = 128;
const MAX_CERTIFICATE_NODES = 10_000;
const textEncoder = new TextEncoder();

export type ReceiptValidationErrorCode =
  | "certificate_too_large"
  | "invalid_certificate"
  | "lossy_number"
  | "multisig_not_supported"
  | "unsupported_operation"
  | "invalid_sender_signature"
  | "network_mismatch"
  | "sender_mismatch"
  | "nonce_mismatch"
  | "tx_id_mismatch"
  | "claim_data_mismatch"
  | "unsupported_schema"
  | "invalid_claim_data"
  | "digest_mismatch"
  | "claim_signer_mismatch";

export class ReceiptValidationError extends Error {
  constructor(
    readonly code: ReceiptValidationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReceiptValidationError";
  }
}

export interface SettlementExpectation {
  readonly network: SignNetwork;
  readonly senderHex: string;
  readonly nonce: bigint;
  readonly txId: string;
  readonly sha256: string;
  readonly claimDataHex: string;
}

export interface ValidatedSettlement {
  readonly txId: string;
  readonly senderHex: string;
  readonly nonce: bigint;
  readonly timestampNanos: bigint;
  readonly claimDataHex: string;
  readonly senderSignatureHex: string;
  readonly signingBytesHex: string;
  readonly transactionBytesHex: string;
  readonly signatureScope: "versioned_transaction";
  readonly settlementTrust: typeof SETTLEMENT_TRUST;
  readonly attestation: ArtifactAttestationV3;
  /** Canonical lossless REST JSON, suitable for durable JSON storage. */
  readonly certificate: string;
}

interface DomainTransaction {
  readonly type: string;
  readonly value: Record<string, unknown>;
}

interface DomainCertificate {
  readonly envelope: {
    readonly transaction: DomainTransaction;
    readonly signature: { readonly type: string; readonly value: Uint8Array };
  };
  readonly signatures: readonly unknown[];
}

function fail(code: ReceiptValidationErrorCode, message: string, cause?: unknown): never {
  throw new ReceiptValidationError(code, message, cause === undefined ? undefined : { cause });
}

/**
 * Copy a caller-owned certificate into bounded SDK-owned data while measuring
 * the exact values that will later be validated or serialized. In particular,
 * getters are evaluated once and never re-read by a subsequent clone.
 */
export function snapshotBoundedObjectCertificate(root: unknown): unknown {
  const ancestors = new Set<object>();
  let nodes = 0;
  let estimatedBytes = 0;
  const addBytes = (count: number): void => {
    estimatedBytes += count;
    if (estimatedBytes > MAX_CERTIFICATE_BYTES) {
      fail("certificate_too_large", "certificate exceeds the 1 MiB parsing limit");
    }
  };
  const addText = (value: string): void => {
    if (value.length > MAX_CERTIFICATE_BYTES) {
      fail("certificate_too_large", "certificate exceeds the 1 MiB parsing limit");
    }
    addBytes(textEncoder.encode(value).byteLength);
  };

  const copyValue = (value: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_CERTIFICATE_NODES) {
      fail("certificate_too_large", "certificate exceeds the object node parsing limit");
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) fail("lossy_number", "certificate contains an unsafe numeric value");
      addText(value.toString());
      return value;
    }
    if (typeof value === "string") {
      addText(value);
      return value;
    }
    if (typeof value === "bigint") {
      addText(value.toString());
      return value;
    }
    if (!value || typeof value !== "object") {
      addBytes(4);
      if (typeof value === "function" || typeof value === "symbol") {
        fail("invalid_certificate", "certificate contains an unsupported value");
      }
      return value;
    }
    if (value instanceof Uint8Array) {
      const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
      const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
      if (!byteLengthGetter) fail("invalid_certificate", "certificate contains an unsupported byte array");
      const byteLength = byteLengthGetter.call(value) as number;
      addBytes(byteLength);
      const copy = new Uint8Array(byteLength);
      copy.set(value);
      return copy;
    }
    if (depth > MAX_CERTIFICATE_DEPTH) {
      fail("certificate_too_large", "certificate exceeds the object depth parsing limit");
    }
    if (ancestors.has(value)) fail("invalid_certificate", "certificate contains a cycle");
    const isArray = Array.isArray(value);
    if (!isArray) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        fail("invalid_certificate", "certificate contains an unsupported object container");
      }
    }
    if (isArray && value.length > MAX_CERTIFICATE_NODES - nodes) {
      // Check the logical array length before asking the host for its keys.
      // Object.keys(array) materializes every dense index, so enumerating
      // first would defeat the aggregate preflight bound for oversized input.
      fail("certificate_too_large", "certificate array exceeds the logical node parsing limit");
    }
    const copy: unknown[] | Record<string, unknown> = isArray ? new Array(value.length) : {};
    ancestors.add(value);
    try {
      const keys = Object.keys(value);
      if (keys.length > MAX_CERTIFICATE_NODES - nodes) {
        fail("certificate_too_large", "certificate exceeds the object node parsing limit");
      }
      if (isArray) {
        // JSON.stringify emits every array slot, including holes as `null`,
        // while Object.keys only reports populated indexes. Charge the full
        // logical array representation before allocating the owned array.
        let populatedSlots = 0;
        for (const key of keys) {
          const index = Number(key);
          if (Number.isInteger(index) && index >= 0 && index < value.length && String(index) === key) {
            populatedSlots += 1;
          }
        }
        const holes = value.length - populatedSlots;
        addBytes(2 + Math.max(0, value.length - 1) + holes * 4);
      }
      for (const key of keys) {
        addText(key);
        const child = copyValue((value as Record<string, unknown>)[key], depth + 1);
        Object.defineProperty(copy, key, { value: child, enumerable: true, writable: true, configurable: true });
      }
      return copy;
    } finally {
      ancestors.delete(value);
    }
  };

  return copyValue(root, 0);
}

function isDomainCertificate(value: unknown): value is DomainCertificate {
  if (!value || typeof value !== "object") return false;
  const envelope = (value as { envelope?: unknown }).envelope;
  if (!envelope || typeof envelope !== "object") return false;
  const transaction = (envelope as { transaction?: unknown }).transaction;
  const signature = (envelope as { signature?: unknown }).signature;
  return Boolean(
    transaction &&
      typeof transaction === "object" &&
      typeof (transaction as { type?: unknown }).type === "string" &&
      signature &&
      typeof signature === "object" &&
      typeof (signature as { type?: unknown }).type === "string",
  );
}

function decodeCertificate(input: unknown): { domain: DomainCertificate; restJson: string } {
  let wire: unknown = input;
  if (typeof input === "string") {
    if (textEncoder.encode(input).byteLength > MAX_CERTIFICATE_BYTES) {
      fail("certificate_too_large", "certificate exceeds the 1 MiB parsing limit");
    }
    try {
      wire = JSONParse(input);
    } catch (error) {
      fail("invalid_certificate", "certificate is not valid lossless JSON", error);
    }
  }
  // Bound and detach the graph too: a short wire string can encode excessive
  // nesting or node counts, while object getters must not be re-read by schema
  // traversal after their values have been measured.
  wire = snapshotBoundedObjectCertificate(wire);

  if (isDomainCertificate(wire) && wire.envelope.signature.type === "MultiSig") {
    fail("multisig_not_supported", "multisig transaction envelopes are not supported");
  }

  try {
    const domain = isDomainCertificate(wire)
      ? (wire as DomainCertificate)
      : (Schema.decodeUnknownSync(TransactionCertificateFromRest)(wire) as unknown as DomainCertificate);
    if (domain.envelope.signature.type === "MultiSig") {
      fail("multisig_not_supported", "multisig transaction envelopes are not supported");
    }
    const encoded = Schema.encodeSync(TransactionCertificateFromRest)(
      domain as unknown as typeof TransactionCertificateFromRest.Type,
    );
    const restJson = JSONStringify(encoded);
    if (textEncoder.encode(restJson).byteLength > MAX_CERTIFICATE_BYTES) {
      fail("certificate_too_large", "certificate exceeds the 1 MiB parsing limit");
    }
    // Validate the same detached canonical representation that will be returned.
    // A caller-owned domain object must not remain live across crypto awaits.
    const ownedDomain = Schema.decodeUnknownSync(TransactionCertificateFromRest)(
      JSONParse(restJson),
    ) as unknown as DomainCertificate;
    return { domain: ownedDomain, restJson };
  } catch (error) {
    if (error instanceof ReceiptValidationError) throw error;
    fail("invalid_certificate", "certificate does not match the public Fast schema", error);
  }
}

/** Compare certificate evidence by its canonical REST representation, not object key order. */
export function certificatesEqual(left: unknown, right: unknown): boolean {
  try {
    return decodeCertificate(left).restJson === decodeCertificate(right).restJson;
  } catch {
    return false;
  }
}

function externalClaimFrom(transaction: DomainTransaction): {
  networkId: SignNetwork;
  sender: Uint8Array;
  nonce: bigint;
  timestampNanos: bigint;
  claimData: Uint8Array;
} {
  const value = transaction.value;
  let operations: unknown;
  if (transaction.type === "Release20260407") operations = value.claims;
  else if (transaction.type === "Release20260319") operations = [value.claim];
  else fail("unsupported_operation", `transaction version ${transaction.type} is not supported`);
  if (!Array.isArray(operations) || operations.length !== 1) {
    fail("unsupported_operation", "receipt must contain exactly one operation");
  }
  const operation = operations[0] as { type?: unknown; value?: unknown };
  if (!operation || operation.type !== "ExternalClaim" || !operation.value || typeof operation.value !== "object") {
    fail("unsupported_operation", "receipt operation must be ExternalClaim");
  }
  const external = operation.value as { claim?: unknown; signatures?: unknown };
  if (!external.claim || typeof external.claim !== "object" || !Array.isArray(external.signatures) || external.signatures.length !== 0) {
    fail("unsupported_operation", "external claim shape is not supported");
  }
  const claim = external.claim as {
    verifierCommittee?: unknown;
    verifierQuorum?: unknown;
    claimData?: unknown;
  };
  if (
    !Array.isArray(claim.verifierCommittee) ||
    claim.verifierCommittee.length !== 0 ||
    claim.verifierQuorum !== 0n ||
    !(claim.claimData instanceof Uint8Array)
  ) {
    fail("unsupported_operation", "receipt requires one quorum-zero ExternalClaim");
  }
  if (
    (value.networkId !== "fast:testnet" && value.networkId !== "fast:mainnet") ||
    !(value.sender instanceof Uint8Array) ||
    value.sender.byteLength !== 32 ||
    typeof value.nonce !== "bigint" ||
    typeof value.timestampNanos !== "bigint"
  ) {
    fail("invalid_certificate", "transaction facts have invalid types");
  }
  return {
    networkId: value.networkId,
    sender: value.sender,
    nonce: value.nonce,
    timestampNanos: value.timestampNanos,
    claimData: claim.claimData,
  };
}

function assertExpectation(expectation: SettlementExpectation): void {
  assertLowerHex(expectation.senderHex, 32, "senderHex");
  assertLowerHex(expectation.txId, 32, "txId");
  assertLowerHex(expectation.sha256, 32, "sha256");
  if (!/^(?:[0-9a-f]{2})+$/.test(expectation.claimDataHex)) {
    throw new Error("claimDataHex must be non-empty lowercase hex");
  }
  if (expectation.nonce < 0n) throw new Error("nonce must be non-negative");
}

export async function validateSettlementCertificate(
  certificate: unknown,
  expectation: SettlementExpectation,
): Promise<ValidatedSettlement> {
  assertExpectation(expectation);
  const { domain, restJson } = decodeCertificate(certificate);
  if (domain.envelope.signature.type !== "Signature" || !(domain.envelope.signature.value instanceof Uint8Array)) {
    fail("multisig_not_supported", "only a single sender signature is supported");
  }
  const facts = externalClaimFrom(domain.envelope.transaction);
  const signingBytes = await encodeTxForWalletSigning(
    domain.envelope.transaction as Parameters<typeof encodeTxForWalletSigning>[0],
  );
  if (
    domain.envelope.signature.value.byteLength !== 64 ||
    !ed.verify(domain.envelope.signature.value, signingBytes, facts.sender, { zip215: false })
  ) {
    fail("invalid_sender_signature", "sender signature failed strict Ed25519 verification");
  }
  const evidence = await deriveTransactionEvidence(domain.envelope.transaction);
  const senderHex = bytesToHex(facts.sender);
  const claimDataHex = bytesToHex(facts.claimData);
  if (facts.networkId !== expectation.network) fail("network_mismatch", "certificate network does not match");
  if (senderHex !== expectation.senderHex) fail("sender_mismatch", "certificate sender does not match");
  if (facts.nonce !== expectation.nonce) fail("nonce_mismatch", "certificate nonce does not match");
  if (evidence.txId !== expectation.txId) fail("tx_id_mismatch", "certificate transaction id does not match");
  if (claimDataHex !== expectation.claimDataHex) fail("claim_data_mismatch", "certificate claim bytes do not match");

  let attestation: ArtifactAttestationV3;
  try {
    attestation = decodeAttestationV3(facts.claimData);
  } catch (error) {
    if (error instanceof AttestationV3Error && error.errorClass === "unsupported_schema") {
      fail("unsupported_schema", "receipt does not contain a supported V3 attestation", error);
    }
    fail("invalid_claim_data", "receipt contains invalid V3 attestation bytes", error);
  }
  if (bytesToHex(attestation.signer) !== senderHex) {
    fail("claim_signer_mismatch", "attestation signer is not the transaction sender");
  }
  if (bytesToHex(attestation.digest) !== expectation.sha256) {
    fail("digest_mismatch", "attestation digest does not match the expected artifact");
  }
  // Decode once more to make accidental hex parser relaxation observable in tests.
  if (bytesToHex(hexToBytes(expectation.claimDataHex)) !== claimDataHex) {
    fail("claim_data_mismatch", "claim data encoding is not canonical");
  }
  return {
    txId: evidence.txId,
    senderHex,
    nonce: facts.nonce,
    timestampNanos: facts.timestampNanos,
    claimDataHex,
    senderSignatureHex: bytesToHex(domain.envelope.signature.value),
    signingBytesHex: bytesToHex(evidence.signingBytes),
    transactionBytesHex: bytesToHex(evidence.transactionBytes),
    signatureScope: "versioned_transaction",
    settlementTrust: SETTLEMENT_TRUST,
    attestation,
    certificate: restJson,
  };
}
