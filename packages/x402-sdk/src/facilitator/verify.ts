/**
 * Payment verification logic
 * Aligned with reference implementation
 */

import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  parseAbi,
} from "viem";
import type {
  PaymentPayload,
  PaymentRequirement,
  VerifyResponse,
  EvmPayload,
  FastPayload,
  FacilitatorConfig,
} from "./types.js";
import { getNetworkType, getNetworkId } from "./types.js";
import {
  FAST_TRUSTED_COMMITTEE_PUBLIC_KEYS,
  getEvmChainConfig,
  getExpectedFastNetworkId,
  getFastRpcUrl,
} from "./chains.js";
import {
  bytesToHex,
  createFastTransactionSigningMessage,
  decodeEnvelope,
  fastAddressToBytes,
  getTransferDetails,
  serializeFastTransaction,
  unwrapFastTransaction,
} from "./fast-bcs.js";

// Type alias for the certificate structure used in verification
interface FastTransactionCertificate {
  envelope: {
    transaction: unknown;
    signature: unknown;
  };
  signatures: unknown[];
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
]);

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const warnedUntrustedCommitteeNetworks = new Set<string>();

export async function verify(
  paymentPayload: PaymentPayload,
  paymentRequirement: PaymentRequirement,
  config: FacilitatorConfig = {},
): Promise<VerifyResponse> {
  if (paymentPayload.network === "fast" || paymentRequirement.network === "fast") {
    return {
      isValid: false,
      invalidReason: "invalid_network",
      network: paymentPayload.network,
    };
  }

  const networkType = getNetworkType(paymentPayload.network);

  switch (networkType) {
    case "evm":
      return verifyEvmPayment(paymentPayload, paymentRequirement);
    case "fast":
      return verifyFastPayment(paymentPayload, paymentRequirement, config);
    default:
      return {
        isValid: false,
        invalidReason: "unsupported_network_type",
        network: paymentPayload.network,
      };
  }
}

async function verifyEvmPayment(
  paymentPayload: PaymentPayload,
  paymentRequirement: PaymentRequirement,
): Promise<VerifyResponse> {
  const chainConfig = getEvmChainConfig(paymentPayload.network);
  if (!chainConfig) {
    return {
      isValid: false,
      invalidReason: "invalid_network",
      network: paymentPayload.network,
    };
  }

  const payload = paymentPayload.payload as EvmPayload;
  if (!payload?.signature || !payload?.authorization) {
    return {
      isValid: false,
      invalidReason: "invalid_payload",
      network: paymentPayload.network,
    };
  }

  const { authorization, signature } = payload;

  if (paymentPayload.scheme !== "exact" || paymentRequirement.scheme !== "exact") {
    return {
      isValid: false,
      invalidReason: "unsupported_scheme",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  if (paymentPayload.network !== paymentRequirement.network) {
    return {
      isValid: false,
      invalidReason: "invalid_network",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  if (authorization.to.toLowerCase() !== paymentRequirement.payTo.toLowerCase()) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_recipient_mismatch",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  const chainId = getNetworkId(paymentPayload.network);
  const name = paymentRequirement.extra?.name ?? chainConfig.usdcName ?? "USD Coin";
  const version = paymentRequirement.extra?.version ?? chainConfig.usdcVersion ?? "2";
  const erc20Address = paymentRequirement.asset as Address;

  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  });

  try {
    const isValidSignature = await client.verifyTypedData({
      address: authorization.from as Address,
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      domain: {
        name: name as string,
        version: version as string,
        chainId,
        verifyingContract: erc20Address,
      },
      message: {
        from: authorization.from as Address,
        to: authorization.to as Address,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as Hex,
      },
      signature: signature as Hex,
    });

    if (!isValidSignature) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_signature",
        payer: authorization.from,
        network: paymentPayload.network,
      };
    }
  } catch {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_signature",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (BigInt(authorization.validBefore) < BigInt(now + 6)) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_valid_before",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  if (BigInt(authorization.validAfter) > BigInt(now)) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_valid_after",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  if (BigInt(authorization.value) < BigInt(paymentRequirement.maxAmountRequired)) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_value",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  try {
    const balance = await client.readContract({
      address: erc20Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [authorization.from as Address],
    });

    if (balance < BigInt(paymentRequirement.maxAmountRequired)) {
      return {
        isValid: false,
        invalidReason: "insufficient_funds",
        payer: authorization.from,
        network: paymentPayload.network,
      };
    }
  } catch {
    return {
      isValid: false,
      invalidReason: "balance_check_failed",
      payer: authorization.from,
      network: paymentPayload.network,
    };
  }

  return {
    isValid: true,
    payer: authorization.from,
    network: paymentPayload.network,
  };
}

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase().replace(/^0x/, "");
}

function normalizeComparableAddress(addr: string): string | null {
  const trimmed = addr.trim();
  if (trimmed.startsWith("fast1") || trimmed.startsWith("set1")) {
    const canonicalFastAddress = trimmed.startsWith("set1")
      ? `fast1${trimmed.slice(4)}`
      : trimmed;

    try {
      return normalizeAddress(bytesToHex(fastAddressToBytes(canonicalFastAddress)));
    } catch {
      return null;
    }
  }

  if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
    return normalizeAddress(trimmed);
  }

  return null;
}

function addressesMatch(a: string, b: string): boolean {
  const left = normalizeComparableAddress(a);
  const right = normalizeComparableAddress(b);
  return left !== null && right !== null && left === right;
}

function toByteArray(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === "string") {
    if (!/^(?:0x)?[0-9a-fA-F]+$/.test(value)) {
      return null;
    }

    const normalized = value.startsWith("0x") ? value.slice(2) : value;
    if (normalized.length === 0 || normalized.length % 2 !== 0) {
      return null;
    }

    return new Uint8Array(Buffer.from(normalized, "hex"));
  }

  if (Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
    return new Uint8Array(value);
  }

  return null;
}

function verifyEd25519(
  publicKeyBytes: Uint8Array,
  message: Uint8Array,
  signatureBytes: Uint8Array,
): boolean {
  if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
    return false;
  }

  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]),
      format: "der",
      type: "spki",
    });

    return verifySignature(null, Buffer.from(message), publicKey, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}

function extractSenderSignature(signature: unknown): Uint8Array | null {
  if (Array.isArray(signature)) {
    return toByteArray(signature);
  }

  if (!signature || typeof signature !== "object") {
    return null;
  }

  return toByteArray((signature as Record<string, unknown>).Signature);
}

function hasMultiSig(signature: unknown): boolean {
  return Boolean(
    signature &&
      typeof signature === "object" &&
      !Array.isArray(signature) &&
      (signature as Record<string, unknown>).MultiSig,
  );
}

function parseCommitteeSignature(
  entry: unknown,
): { publicKey: Uint8Array; signature: Uint8Array } | null {
  if (Array.isArray(entry) && entry.length === 2) {
    const publicKey = toByteArray(entry[0]);
    const signature = toByteArray(entry[1]);
    if (!publicKey || !signature) {
      return null;
    }

    return { publicKey, signature };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const publicKey = toByteArray(record.committee_member ?? record.validator);
  const signature = toByteArray(record.signature);
  if (!publicKey || !signature) {
    return null;
  }

  return { publicKey, signature };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

function signatureKey(publicKey: Uint8Array, signature: Uint8Array): string {
  return `${Buffer.from(publicKey).toString("hex")}:${Buffer.from(signature).toString("hex")}`;
}

function quorumThreshold(totalMembers: number): number {
  return Math.floor((2 * totalMembers) / 3) + 1;
}

interface ResolvedTrustedCommittee {
  memberKeys: Set<string>;
  minSignatures: number;
}

function parseTrustedCommitteePublicKey(value: string): string | null {
  const bytes = toByteArray(value);
  if (bytes?.length === 32) {
    return Buffer.from(bytes).toString("hex");
  }

  const normalized = value.startsWith("set1") ? `fast1${value.slice(4)}` : value;
  if (!normalized.startsWith("fast1")) {
    return null;
  }

  try {
    return normalizeAddress(bytesToHex(fastAddressToBytes(normalized)));
  } catch {
    return null;
  }
}

function resolveTrustedCommittee(
  network: string,
  config: FacilitatorConfig,
): ResolvedTrustedCommittee | null {
  const configuredKeys = config.committeePublicKeys?.[network];
  const bundledKeys = FAST_TRUSTED_COMMITTEE_PUBLIC_KEYS[network];
  const keys = configuredKeys ?? bundledKeys;
  if (!keys?.length) {
    return null;
  }

  const memberKeys = new Set<string>();
  for (const key of keys) {
    const parsed = parseTrustedCommitteePublicKey(key);
    if (!parsed) {
      throw new Error(`invalid_committee_public_key:${key}`);
    }
    memberKeys.add(parsed);
  }

  if (memberKeys.size === 0) {
    throw new Error("empty_committee_public_keys");
  }

  return {
    memberKeys,
    minSignatures: quorumThreshold(memberKeys.size),
  };
}

function warnUntrustedCommittee(network: string, fastRpcUrl?: string): void {
  const rpcUrl = getFastRpcUrl(network, fastRpcUrl);
  const warningKey = `${network}:${rpcUrl}`;
  if (warnedUntrustedCommitteeNetworks.has(warningKey)) {
    return;
  }

  warnedUntrustedCommitteeNetworks.add(warningKey);
  console.warn(
    `x402-facilitator: no trusted Fast committee configured for ${network}; ` +
      `verification is trusting ${rpcUrl} for committee membership.`,
  );
}

interface FastRpcAccountInfoResponse {
  requested_certificates: FastTransactionCertificate[] | null;
}

async function fetchFastCertificateByNonce(
  network: string,
  senderPublicKey: Uint8Array,
  nonce: bigint,
  fastRpcUrl?: string,
): Promise<FastTransactionCertificate | null> {
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("nonce_out_of_range");
  }

  const response = await fetch(getFastRpcUrl(network, fastRpcUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "proxy_getAccountInfo",
      params: {
        address: Array.from(senderPublicKey),
        token_balances_filter: [],
        certificate_by_nonce: {
          start: Number(nonce),
          limit: 1,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`http_${response.status}`);
  }

  const json = (await response.json()) as {
    result?: FastRpcAccountInfoResponse;
    error?: { message?: string };
  };

  if (json.error) {
    throw new Error(json.error.message || "unknown_rpc_error");
  }

  return json.result?.requested_certificates?.[0] ?? null;
}

async function verifyFastPayment(
  paymentPayload: PaymentPayload,
  paymentRequirement: PaymentRequirement,
  config: FacilitatorConfig,
): Promise<VerifyResponse> {
  if (paymentPayload.scheme !== "exact" || paymentRequirement.scheme !== "exact") {
    return {
      isValid: false,
      invalidReason: "unsupported_scheme",
      network: paymentPayload.network,
    };
  }

  if (paymentPayload.network !== paymentRequirement.network) {
    return {
      isValid: false,
      invalidReason: "invalid_network",
      network: paymentPayload.network,
    };
  }

  const payload = paymentPayload.payload as FastPayload;
  if (!payload?.transactionCertificate) {
    return {
      isValid: false,
      invalidReason: "invalid_payload",
      network: paymentPayload.network,
    };
  }

  const expectedNetworkId = getExpectedFastNetworkId(paymentPayload.network);
  if (!expectedNetworkId) {
    return {
      isValid: false,
      invalidReason: "invalid_network",
      network: paymentPayload.network,
    };
  }

  const certificate = payload.transactionCertificate as FastTransactionCertificate;
  const { envelope, signatures } = certificate;

  if (!envelope) {
    return {
      isValid: false,
      invalidReason: "missing_envelope",
      network: paymentPayload.network,
    };
  }

  if (!Array.isArray(signatures) || signatures.length === 0) {
    return {
      isValid: false,
      invalidReason: "missing_signatures",
      network: paymentPayload.network,
    };
  }

  if (typeof envelope !== "object" || envelope === null) {
    return {
      isValid: false,
      invalidReason: "unsupported_fast_certificate_format",
      network: paymentPayload.network,
    };
  }

  if (!("transaction" in envelope) || !envelope.transaction) {
    return {
      isValid: false,
      invalidReason: "missing_transaction",
      network: paymentPayload.network,
    };
  }

  if (hasMultiSig(envelope.signature)) {
    return {
      isValid: false,
      invalidReason: "unsupported_fast_transaction_multisig",
      network: paymentPayload.network,
    };
  }

  const senderSignature = extractSenderSignature(envelope.signature);
  if (!senderSignature) {
    return {
      isValid: false,
      invalidReason: "missing_transaction_signature",
      network: paymentPayload.network,
    };
  }

  let transaction;
  let transactionBytes: Uint8Array;
  try {
    transaction = unwrapFastTransaction(envelope.transaction);
    transactionBytes = serializeFastTransaction(transaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isValid: false,
      invalidReason: message === "not_a_token_transfer"
        ? message
        : `invalid_transaction: ${message}`,
      network: paymentPayload.network,
    };
  }

  let senderHex: string;
  let recipientHex: string;
  let tokenIdHex: string;
  let amountBigInt: bigint;
  let nonce: bigint;
  try {
    const decoded = decodeEnvelope(transactionBytes);
    if (decoded.network_id !== expectedNetworkId) {
      return {
        isValid: false,
        invalidReason: `network_id_mismatch: expected ${expectedNetworkId}, got ${decoded.network_id}`,
        network: paymentPayload.network,
      };
    }

    const transferDetails = getTransferDetails(decoded);
    if (!transferDetails) {
      return {
        isValid: false,
        invalidReason: "not_a_token_transfer",
        network: paymentPayload.network,
      };
    }

    senderHex = transferDetails.sender;
    recipientHex = transferDetails.recipient;
    tokenIdHex = transferDetails.tokenId;
    amountBigInt = transferDetails.amount;
    nonce = decoded.nonce;
  } catch (resultOrError) {
    if (
      resultOrError &&
      typeof resultOrError === "object" &&
      "isValid" in resultOrError &&
      "network" in resultOrError
    ) {
      return resultOrError as VerifyResponse;
    }

    return {
      isValid: false,
      invalidReason: `invalid_transaction: ${
        resultOrError instanceof Error ? resultOrError.message : String(resultOrError)
      }`,
      network: paymentPayload.network,
    };
  }

  let trustedCommittee: ResolvedTrustedCommittee | null;
  try {
    trustedCommittee = resolveTrustedCommittee(paymentPayload.network, config);
  } catch (error) {
    return {
      isValid: false,
      invalidReason: `invalid_committee_configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
      network: paymentPayload.network,
    };
  }

  if (!trustedCommittee) {
    warnUntrustedCommittee(paymentPayload.network, config.fastRpcUrl);
  }

  const minSignatures = trustedCommittee?.minSignatures ?? 3;
  if (signatures.length < minSignatures) {
    return {
      isValid: false,
      invalidReason: `insufficient_signatures: need ${minSignatures}, got ${signatures.length}`,
      network: paymentPayload.network,
    };
  }

  const senderPublicKey = toByteArray(transaction.sender);
  if (!senderPublicKey) {
    return {
      isValid: false,
      invalidReason: "invalid_transaction: invalid_sender",
      network: paymentPayload.network,
    };
  }

  if (
    !verifyEd25519(
      senderPublicKey,
      createFastTransactionSigningMessage(transactionBytes),
      senderSignature,
    )
  ) {
    return {
      isValid: false,
      invalidReason: "invalid_fast_transaction_signature",
      payer: senderHex,
      network: paymentPayload.network,
    };
  }

  const seenCommitteeMembers = new Set<string>();
  for (const signatureEntry of signatures) {
    const parsedSignature = parseCommitteeSignature(signatureEntry);
    if (!parsedSignature) {
      return {
        isValid: false,
        invalidReason: "unsupported_fast_certificate_format",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }

    const memberKey = Buffer.from(parsedSignature.publicKey).toString("hex");
    if (seenCommitteeMembers.has(memberKey)) {
      return {
        isValid: false,
        invalidReason: "duplicate_committee_signature",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }
    seenCommitteeMembers.add(memberKey);

    if (trustedCommittee && !trustedCommittee.memberKeys.has(memberKey)) {
      return {
        isValid: false,
        invalidReason: "unknown_fast_committee_signer",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }

    if (!verifyEd25519(parsedSignature.publicKey, createFastTransactionSigningMessage(transactionBytes), parsedSignature.signature)) {
      return {
        isValid: false,
        invalidReason: "invalid_fast_committee_signature",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }
  }

  // Certificate lookup is optional
  let networkCertificate: FastTransactionCertificate | null = null;
  let skipNetworkValidation = false;
  try {
    networkCertificate = await fetchFastCertificateByNonce(
      paymentPayload.network,
      senderPublicKey,
      nonce,
      config.fastRpcUrl,
    );
    if (!networkCertificate) {
      skipNetworkValidation = true;
    }
  } catch {
    skipNetworkValidation = true;
  }

  // Cross-validate with network certificate if available
  if (!skipNetworkValidation && networkCertificate) {
    let networkTransactionBytes: Uint8Array;
    try {
      networkTransactionBytes = serializeFastTransaction(
        unwrapFastTransaction(networkCertificate.envelope.transaction),
      );
    } catch {
      return {
        isValid: false,
        invalidReason: "invalid_network_fast_certificate",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }

    if (!bytesEqual(transactionBytes, networkTransactionBytes)) {
      return {
        isValid: false,
        invalidReason: "fast_certificate_mismatch",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }

    const networkSenderSignature = extractSenderSignature(networkCertificate.envelope.signature);
    if (!networkSenderSignature || !bytesEqual(senderSignature, networkSenderSignature)) {
      return {
        isValid: false,
        invalidReason: "fast_certificate_mismatch",
        payer: senderHex,
        network: paymentPayload.network,
      };
    }

    const networkCommitteeSignatureKeys = new Set<string>();
    for (const signatureEntry of networkCertificate.signatures) {
      const parsedSignature = parseCommitteeSignature(signatureEntry);
      if (!parsedSignature) {
        return {
          isValid: false,
          invalidReason: "invalid_network_fast_certificate",
          payer: senderHex,
          network: paymentPayload.network,
        };
      }

      networkCommitteeSignatureKeys.add(
        signatureKey(parsedSignature.publicKey, parsedSignature.signature),
      );
    }

    for (const signatureEntry of signatures) {
      const parsedSignature = parseCommitteeSignature(signatureEntry);
      if (!parsedSignature) {
        return {
          isValid: false,
          invalidReason: "unsupported_fast_certificate_format",
          payer: senderHex,
          network: paymentPayload.network,
        };
      }

      if (
        !networkCommitteeSignatureKeys.has(
          signatureKey(parsedSignature.publicKey, parsedSignature.signature),
        )
      ) {
        return {
          isValid: false,
          invalidReason: "fast_certificate_mismatch",
          payer: senderHex,
          network: paymentPayload.network,
        };
      }
    }
  }

  if (!addressesMatch(recipientHex, paymentRequirement.payTo)) {
    return {
      isValid: false,
      invalidReason: `recipient_mismatch: expected ${paymentRequirement.payTo}, got ${recipientHex}`,
      payer: senderHex,
      network: paymentPayload.network,
    };
  }

  const requiredAmount = BigInt(paymentRequirement.maxAmountRequired);
  if (amountBigInt < requiredAmount) {
    return {
      isValid: false,
      invalidReason: `insufficient_amount: required ${requiredAmount.toString()}, got ${amountBigInt.toString()}`,
      payer: senderHex,
      network: paymentPayload.network,
    };
  }

  if (paymentRequirement.asset) {
    const normalizedAsset = normalizeAddress(paymentRequirement.asset);
    const normalizedTokenId = normalizeAddress(tokenIdHex);
    if (normalizedAsset !== normalizedTokenId) {
      return {
        isValid: false,
        invalidReason: `token_mismatch: expected ${paymentRequirement.asset}, got ${tokenIdHex}`,
        payer: senderHex,
        network: paymentPayload.network,
      };
    }
  }

  return {
    isValid: true,
    payer: senderHex,
    network: paymentPayload.network,
  };
}
