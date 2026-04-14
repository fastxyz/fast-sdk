/**
 * Fast BCS helpers using @fastxyz/sdk and @fastxyz/schema.
 *
 * Pure BCS serialization/deserialization utilities — no hardcoded network config.
 * Supports both Release20260319 (.claim) and Release20260407 (.claims[]) transactions.
 */

import { toHex, fromHex, toFastAddress, fromFastAddress } from '@fastxyz/sdk';
import { bcsSchema } from '@fastxyz/schema';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { toHex as bytesToHex, fromHex as hexToBytes, fromFastAddress as fastAddressToBytes };

// ─── Types ───────────────────────────────────────────────────────────────────

/** Release20260319 decoded transaction — single `.claim` field. */
export interface DecodedFastTransaction20260319 {
  version: 'Release20260319';
  network_id: string;
  sender: Uint8Array | number[];
  nonce: bigint;
  timestamp_nanos: bigint;
  claim: unknown;
  archival: boolean;
  fee_token: Uint8Array | number[] | null;
}

/** Release20260407 decoded transaction — `.claims[]` (vector of operations). */
export interface DecodedFastTransaction20260407 {
  version: 'Release20260407';
  network_id: string;
  sender: Uint8Array | number[];
  nonce: bigint;
  timestamp_nanos: bigint;
  claims: unknown[];
  archival: boolean;
  fee_token: Uint8Array | number[] | null;
}

export type DecodedFastTransaction = DecodedFastTransaction20260319 | DecodedFastTransaction20260407;

export interface TransferDetails {
  sender: string;
  recipient: string;
  tokenId: string;
  amount: bigint;
}

export type FastSerializableTransaction = Record<string, unknown>;
export type VersionedFastTransaction = Record<string, unknown>;

type TransactionVersionKey = 'Release20260319' | 'Release20260407';

// ─── BCS types ───────────────────────────────────────────────────────────────

export const TransactionBcs = bcsSchema.Transaction20260319;
export const Transaction20260407Bcs = bcsSchema.Transaction20260407;
export const VersionedTransactionBcs = bcsSchema.VersionedTransaction;

// ─── Constants ───────────────────────────────────────────────────────────────

const FAST_TRANSACTION_SIGNING_PREFIX = new TextEncoder().encode('VersionedTransaction::');
const KNOWN_VERSIONS: TransactionVersionKey[] = ['Release20260319', 'Release20260407'];

// ─── Internal Helpers ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesToHexString(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return toHex(arr);
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    return new Uint8Array(value);
  }
  if (typeof value === 'string') {
    const normalized = value.startsWith('0x') ? value.slice(2) : value;
    if (/^[0-9a-fA-F]*$/.test(normalized) && normalized.length % 2 === 0) {
      return fromHex(normalized);
    }
  }
  return null;
}

/** Detect which version wrapper a transaction object uses, or null if bare. */
function detectVersion(transaction: Record<string, unknown>): TransactionVersionKey | null {
  for (const version of KNOWN_VERSIONS) {
    if (version in transaction && isRecord(transaction[version])) {
      return version;
    }
  }
  return null;
}

/** Infer version from a bare (unwrapped) transaction based on its fields. */
function inferBareVersion(transaction: Record<string, unknown>): TransactionVersionKey {
  if ('claims' in transaction && Array.isArray(transaction.claims)) {
    return 'Release20260407';
  }
  return 'Release20260319';
}

// ─── Public Functions ────────────────────────────────────────────────────────

export interface UnwrappedTransaction {
  version: TransactionVersionKey;
  inner: FastSerializableTransaction;
}

export function unwrapFastTransaction(transaction: unknown): FastSerializableTransaction {
  return unwrapFastTransactionVersioned(transaction).inner;
}

export function unwrapFastTransactionVersioned(transaction: unknown): UnwrappedTransaction {
  if (!isRecord(transaction)) {
    throw new Error('unsupported_fast_transaction_format');
  }

  const version = detectVersion(transaction);
  if (version) {
    return { version, inner: transaction[version] as FastSerializableTransaction };
  }

  if (typeof transaction.network_id === 'string') {
    return { version: inferBareVersion(transaction), inner: transaction as FastSerializableTransaction };
  }

  throw new Error('unsupported_fast_transaction_format');
}

export function serializeFastTransaction(transaction: VersionedFastTransaction | FastSerializableTransaction): Uint8Array {
  if (!isRecord(transaction)) {
    throw new Error('unsupported_fast_transaction_format');
  }

  const version = detectVersion(transaction);
  if (version) {
    return VersionedTransactionBcs.serialize({
      [version]: transaction[version],
    } as any).toBytes();
  }

  // Bare transaction — infer version from shape
  const inferredVersion = inferBareVersion(transaction);
  return VersionedTransactionBcs.serialize({
    [inferredVersion]: transaction,
  } as any).toBytes();
}

export function serializeVersionedTransaction(transaction: FastSerializableTransaction, version?: TransactionVersionKey): Uint8Array {
  const v = version ?? inferBareVersion(transaction);
  return VersionedTransactionBcs.serialize({
    [v]: transaction,
  } as any).toBytes();
}

export function pubkeyToAddress(pubkey: Uint8Array): string {
  return toFastAddress(pubkey);
}

export function decodeEnvelope(envelope: string | number[] | Uint8Array): DecodedFastTransaction {
  let bytes: Uint8Array;
  if (typeof envelope === 'string') {
    const hex = envelope.startsWith('0x') ? envelope.slice(2) : envelope;
    bytes = fromHex(hex);
  } else if (Array.isArray(envelope)) {
    bytes = new Uint8Array(envelope);
  } else {
    bytes = envelope;
  }

  const decoded = VersionedTransactionBcs.parse(bytes);

  if (isRecord(decoded)) {
    if ('Release20260407' in decoded) {
      const inner = decoded.Release20260407 as Record<string, unknown>;
      return { version: 'Release20260407', ...inner } as unknown as DecodedFastTransaction20260407;
    }
    if ('Release20260319' in decoded) {
      const inner = decoded.Release20260319 as Record<string, unknown>;
      return { version: 'Release20260319', ...inner } as unknown as DecodedFastTransaction20260319;
    }
  }

  return { version: 'Release20260319', ...(decoded as Record<string, unknown>) } as unknown as DecodedFastTransaction20260319;
}

/**
 * Extract the first TokenTransfer from a decoded transaction.
 * Handles both Release20260319 (.claim) and Release20260407 (.claims[]).
 */
export function getTransferDetails(decoded: DecodedFastTransaction): TransferDetails | null {
  let transfer: Record<string, unknown> | null = null;

  if (decoded.version === 'Release20260407') {
    // Release20260407: claims is a Vec<Operation>
    const claims = (decoded as DecodedFastTransaction20260407).claims;
    if (Array.isArray(claims)) {
      transfer = findTokenTransferInOps(claims);
    }
  } else {
    // Release20260319: claim is a single ClaimType (tagged union)
    const claim = (decoded as DecodedFastTransaction20260319).claim;
    if (isRecord(claim)) {
      if ('TokenTransfer' in claim && isRecord(claim.TokenTransfer)) {
        transfer = claim.TokenTransfer as Record<string, unknown>;
      } else if ('Batch' in claim && Array.isArray(claim.Batch)) {
        transfer = findTokenTransferInOps(claim.Batch);
      }
    }
  }

  if (!transfer) return null;

  const senderBytes = toUint8Array(decoded.sender);
  const recipientBytes = toUint8Array(transfer.recipient);
  const tokenIdBytes = toUint8Array(transfer.token_id);

  if (!senderBytes || !recipientBytes || !tokenIdBytes) {
    throw new Error('not_a_token_transfer');
  }

  const amount = toBigInt(transfer.amount);

  return {
    sender: bytesToHexString(senderBytes),
    recipient: bytesToHexString(recipientBytes),
    tokenId: bytesToHexString(tokenIdBytes),
    amount,
  };
}

export function createFastTransactionSigningMessage(transactionBytes: Uint8Array): Uint8Array {
  const message = new Uint8Array(FAST_TRANSACTION_SIGNING_PREFIX.length + transactionBytes.length);
  message.set(FAST_TRANSACTION_SIGNING_PREFIX, 0);
  message.set(transactionBytes, FAST_TRANSACTION_SIGNING_PREFIX.length);
  return message;
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function findTokenTransferInOps(ops: unknown[]): Record<string, unknown> | null {
  for (const op of ops) {
    if (isRecord(op) && 'TokenTransfer' in op && isRecord(op.TokenTransfer)) {
      return op.TokenTransfer as Record<string, unknown>;
    }
  }
  return null;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new Error('not_a_token_transfer');
}
