// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { encode, hashHex } from "@fastxyz/sdk";
import { encodeTxForWalletSigning } from "@fastxyz/sdk/wallet";
import {
  getTransactionVersionConfig,
  LatestTransactionVersion,
  SignatureFromInput,
  VersionedTransactionFromBcs,
  bcsSchema,
} from "@fastxyz/schema";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { Schema } from "effect";

import {
  InvalidSignerSignatureError,
  SignerMismatchError,
} from "../errors.js";
import { fastAddressFromPublicKey } from "./address.js";
import { assertLowerHex, bytesToHex } from "./bytes.js";
import type { ByteSigner, SignNetwork } from "../types.js";

// Noble v2 synchronous verification requires SHA-512 to be installed once.
// The package deliberately does not claim sideEffects:false while this is used.
ed.etc.sha512Sync = (...messages: Uint8Array[]) => sha512(ed.etc.concatBytes(...messages));

const decodeUnknown = Schema.decodeUnknownSync as (schema: unknown) => (input: unknown) => unknown;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_SIGNING_BYTES = 4_096;
const EVEN_LOWER_HEX = /^(?:[0-9a-f]{2})+$/;

export interface PrepareExternalClaimInput {
  readonly network: SignNetwork;
  readonly senderPublicKey: Uint8Array;
  readonly nonce: bigint;
  readonly claimDataHex: string;
  readonly feeToken: string | null;
  readonly timestampNanos: bigint;
}

export interface PreparedExternalClaimTransaction {
  readonly network: SignNetwork;
  readonly senderPublicKey: Uint8Array;
  readonly senderPublicKeyHex: string;
  readonly senderAddress: string;
  readonly nonce: bigint;
  readonly timestampNanos: bigint;
  readonly claimDataHex: string;
  readonly feeToken: string | null;
  readonly versioned: unknown;
  readonly signingBytes: Uint8Array;
  readonly transactionBytes: Uint8Array;
  readonly txId: string;
}

export interface SignedExternalClaimTransaction extends PreparedExternalClaimTransaction {
  readonly senderSignature: Uint8Array;
  readonly senderSignatureHex: string;
  readonly envelope: unknown;
}

export interface FastSdkProviderLike {
  getAccountInfo(input: {
    readonly address: string;
    readonly tokenBalancesFilter: null;
    readonly stateKeyFilter: null;
  }): Promise<{ readonly nextNonce: unknown }>;
  submitTransaction(envelope: unknown): Promise<unknown>;
}

export interface FastSettlementProvider {
  getNextNonce(address: string): Promise<bigint>;
  submitTransaction(envelope: unknown): Promise<unknown>;
}

/**
 * Adapt the public `FastProvider` capability used by the SDK. Reading the nonce
 * and submitting stay separate so recovery clients can be constructed without
 * either capability.
 */
export function createFastSdkProviderAdapter(
  provider: FastSdkProviderLike,
): FastSettlementProvider {
  const accountInfoMethod = provider?.getAccountInfo;
  const submitMethod = provider?.submitTransaction;
  if (
    !provider ||
    typeof accountInfoMethod !== "function" ||
    typeof submitMethod !== "function"
  ) {
    throw new Error("provider must implement getAccountInfo() and submitTransaction()");
  }
  const getAccountInfo = Function.prototype.bind.call(accountInfoMethod, provider);
  const submitTransaction = Function.prototype.bind.call(submitMethod, provider);
  return {
    async getNextNonce(address) {
      const info = await getAccountInfo({
        address,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
      });
      if (typeof info.nextNonce !== "bigint") {
        throw new Error("FastProvider nextNonce must be a bigint");
      }
      assertU64(info.nextNonce, "nextNonce");
      return info.nextNonce;
    },
    submitTransaction,
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function assertNetwork(network: string): asserts network is SignNetwork {
  if (network !== "fast:testnet" && network !== "fast:mainnet") {
    throw new Error("network must be fast:testnet or fast:mainnet");
  }
}

export function nonceToSafeNumber(nonce: bigint): number {
  if (typeof nonce !== "bigint") throw new TypeError("nonce must be a bigint");
  if (nonce < 0n || nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Transaction nonce ${nonce} is outside the supported range (0…2^53−1).`);
  }
  return Number(nonce);
}

function assertU64(value: bigint, field: string): void {
  if (value < 0n || value > MAX_U64) throw new Error(`${field} is outside the u64 range`);
}

export async function deriveTransactionEvidence(versioned: unknown): Promise<{
  signingBytes: Uint8Array;
  transactionBytes: Uint8Array;
  txId: string;
}> {
  // Own the complete transaction before the first await. The public helper is
  // callable from plain JavaScript, so a caller may otherwise mutate the
  // versioned object between the wallet encoding and BCS/hash derivations.
  const ownedVersioned = structuredClone(versioned);
  const typed = ownedVersioned as Parameters<typeof encodeTxForWalletSigning>[0];
  const signingBytes = await encodeTxForWalletSigning(typed);
  const bcsInput = Schema.encodeSync(VersionedTransactionFromBcs)(
    ownedVersioned as typeof VersionedTransactionFromBcs.Type,
  );
  const [transactionBytes, txIdWithPrefix] = await Promise.all([
    encode(bcsSchema.VersionedTransaction, bcsInput),
    hashHex(bcsSchema.VersionedTransaction, bcsInput),
  ]);
  return {
    signingBytes,
    transactionBytes,
    txId: txIdWithPrefix.replace(/^0x/i, "").toLowerCase(),
  };
}

export async function prepareExternalClaimTransaction(
  input: PrepareExternalClaimInput,
): Promise<PreparedExternalClaimTransaction> {
  assertNetwork(input.network);
  if (!(input.senderPublicKey instanceof Uint8Array) || input.senderPublicKey.byteLength !== 32) {
    throw new Error("senderPublicKey must be 32 bytes");
  }
  nonceToSafeNumber(input.nonce);
  assertU64(input.timestampNanos, "timestampNanos");
  if (
    typeof input.claimDataHex !== "string" ||
    !EVEN_LOWER_HEX.test(input.claimDataHex) ||
    input.claimDataHex.length / 2 > 4_096
  ) {
    throw new Error("claimDataHex must be non-empty lowercase hex within 4096 bytes");
  }
  if (input.feeToken !== null) assertLowerHex(input.feeToken, 32, "feeToken");
  const senderPublicKey = Uint8Array.from(input.senderPublicKey);
  const network = input.network;
  const nonce = input.nonce;
  const timestampNanos = input.timestampNanos;
  const claimDataHex = input.claimDataHex;
  const feeToken = input.feeToken;
  const senderPublicKeyHex = bytesToHex(senderPublicKey);
  const senderAddress = fastAddressFromPublicKey(senderPublicKey);
  const configuration = getTransactionVersionConfig(LatestTransactionVersion) as unknown as {
    inputSchema: unknown;
    wrapOperations(operations: unknown[]): object;
  };
  const externalClaim = {
    type: "ExternalClaim",
    value: {
      claim: {
        verifierCommittee: [],
        verifierQuorum: 0,
        claimData: `0x${claimDataHex}`,
      },
      signatures: [],
    },
  };
  const transaction = decodeUnknown(configuration.inputSchema)({
    networkId: network,
    sender: senderAddress,
    nonce,
    timestampNanos,
    ...configuration.wrapOperations([externalClaim]),
    archival: false,
    feeToken,
  });
  const versioned = { type: LatestTransactionVersion, value: transaction };
  const evidence = await deriveTransactionEvidence(versioned);
  if (evidence.signingBytes.byteLength > MAX_SIGNING_BYTES) {
    throw new Error(
      `ExternalClaim signing bytes (${evidence.signingBytes.byteLength}) exceed the ${MAX_SIGNING_BYTES} byte limit`,
    );
  }
  return {
    network,
    senderPublicKey,
    senderPublicKeyHex,
    senderAddress,
    nonce,
    timestampNanos,
    claimDataHex,
    feeToken,
    versioned,
    signingBytes: Uint8Array.from(evidence.signingBytes),
    transactionBytes: Uint8Array.from(evidence.transactionBytes),
    txId: evidence.txId,
  };
}

export async function signPreparedTransaction(
  prepared: PreparedExternalClaimTransaction,
  signer: ByteSigner,
): Promise<SignedExternalClaimTransaction> {
  if (
    !signer ||
    typeof signer.getPublicKey !== "function" ||
    typeof signer.signMessage !== "function"
  ) {
    throw new Error("signer must implement getPublicKey() and signMessage(bytes)");
  }
  const canonical = await prepareExternalClaimTransaction({
    network: prepared.network,
    senderPublicKey: prepared.senderPublicKey,
    nonce: prepared.nonce,
    claimDataHex: prepared.claimDataHex,
    feeToken: prepared.feeToken,
    timestampNanos: prepared.timestampNanos,
  });
  const suppliedEvidence = await deriveTransactionEvidence(prepared.versioned);
  if (
    canonical.txId !== prepared.txId ||
    !sameBytes(canonical.signingBytes, prepared.signingBytes) ||
    !sameBytes(canonical.transactionBytes, prepared.transactionBytes) ||
    suppliedEvidence.txId !== canonical.txId ||
    !sameBytes(suppliedEvidence.signingBytes, canonical.signingBytes) ||
    !sameBytes(suppliedEvidence.transactionBytes, canonical.transactionBytes)
  ) {
    throw new Error("prepared transaction evidence changed before signing");
  }
  const actualPublicKey = await signer.getPublicKey();
  if (!(actualPublicKey instanceof Uint8Array) || actualPublicKey.byteLength !== 32) {
    throw new Error("signer getPublicKey() must return 32 bytes");
  }
  if (!sameBytes(actualPublicKey, canonical.senderPublicKey)) {
    throw new SignerMismatchError(canonical.senderPublicKeyHex, bytesToHex(actualPublicKey));
  }
  const signature = await signer.signMessage(Uint8Array.from(canonical.signingBytes));
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
    throw new InvalidSignerSignatureError("signer must return one 64-byte Ed25519 signature");
  }
  if (!ed.verify(signature, canonical.signingBytes, canonical.senderPublicKey, { zip215: false })) {
    throw new InvalidSignerSignatureError("the signer response failed strict local verification");
  }
  const senderSignature = Uint8Array.from(signature);
  const senderSignatureHex = bytesToHex(senderSignature);
  const signatureValue = decodeUnknown(SignatureFromInput)(`0x${senderSignatureHex}`);
  return {
    ...canonical,
    senderSignature,
    senderSignatureHex,
    envelope: {
      transaction: canonical.versioned,
      signature: { type: "Signature", value: signatureValue },
    },
  };
}
