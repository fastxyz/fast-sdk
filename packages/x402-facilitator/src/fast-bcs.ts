/**
 * Fast BCS helpers using @fastxyz/sdk and @fastxyz/schema.
 *
 * Pure BCS serialization/deserialization utilities — no hardcoded network config.
 */

import { toHex, fromHex, toFastAddress, fromFastAddress } from '@fastxyz/sdk';
import { bcsSchema } from '@fastxyz/schema';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { toHex as bytesToHex, fromHex as hexToBytes, fromFastAddress as fastAddressToBytes };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecodedFastTransaction {
  network_id: string;
  sender: Uint8Array | number[];
  nonce: bigint;
  timestamp_nanos: bigint;
  claim: unknown;
  archival: boolean;
  fee_token: Uint8Array | number[] | null;
}

export interface TransferDetails {
  sender: string;
  recipient: string;
  tokenId: string;
  amount: bigint;
}

export type FastSerializableTransaction = Record<string, unknown>;
export type VersionedFastTransaction = Record<string, unknown>;

// ─── BCS types ───────────────────────────────────────────────────────────────

export const TransactionBcs = bcsSchema.Transaction20260319;
export const VersionedTransactionBcs = bcsSchema.VersionedTransaction;

// ─── Constants ───────────────────────────────────────────────────────────────

const FAST_TRANSACTION_SIGNING_PREFIX = new TextEncoder().encode('VersionedTransaction::');

// ─── camelCase → snake_case keys for BCS serialization ──────────────────────

const CAMEL_TO_SNAKE: Record<string, string> = {
  networkId: 'network_id',
  timestampNanos: 'timestamp_nanos',
  feeToken: 'fee_token',
  tokenId: 'token_id',
  userData: 'user_data',
  verifierCommittee: 'verifier_committee',
  verifierQuorum: 'verifier_quorum',
  claimData: 'claim_data',
  authorizedSigners: 'authorized_signers',
};

/**
 * Recursively convert from Effect schema decoded form (camelCase keys,
 * typed variants) to BCS-compatible format (snake_case keys, keyed variants).
 *
 * NOTE: We use a manual conversion here instead of Schema.encodeSync(VersionedTransactionFromBcs)
 * because the facilitator receives data after a JSON roundtrip (client → HTTP → facilitator).
 * During JSON serialization, bigints become decimal strings ("42") and Uint8Arrays become
 * number arrays. The Effect Schema encode path expects the exact Type format (real bigints,
 * branded Uint8Arrays), which the JSON-roundtripped data doesn't match.
 */
function toBcsFormat(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    // Convert decimal numeric strings to bigint (handles JSON roundtrip of bigints)
    if (/^\d+$/.test(value)) return BigInt(value);
    return value;
  }
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(toBcsFormat);
  if (!isRecord(value)) return value;

  // Typed variant: {type: "Foo", value: {...}} → {Foo: {...}}
  if (typeof value.type === 'string' && 'value' in value && Object.keys(value).length === 2) {
    const variantValue = value.value;
    if (variantValue === null || variantValue === undefined) {
      return { [value.type as string]: variantValue };
    }
    return { [value.type as string]: toBcsFormat(variantValue) };
  }

  // Regular object: convert keys from camelCase to snake_case
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const snakeKey = CAMEL_TO_SNAKE[key] ?? key;
    result[snakeKey] = toBcsFormat(val);
  }
  return result;
}

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

// ─── Public Functions ────────────────────────────────────────────────────────

export function unwrapFastTransaction(transaction: unknown): FastSerializableTransaction {
  // RPC wire format: {Release20260319: {network_id: ..., ...}}
  if (isRecord(transaction) && 'Release20260319' in transaction && isRecord(transaction.Release20260319)) {
    return transaction.Release20260319 as FastSerializableTransaction;
  }

  // Effect schema decoded format: {type: "Release20260319", value: {networkId: ..., ...}}
  if (isRecord(transaction) && typeof transaction.type === 'string' && isRecord(transaction.value)) {
    return transaction.value as FastSerializableTransaction;
  }

  // Already unwrapped (snake_case)
  if (isRecord(transaction) && typeof transaction.network_id === 'string') {
    return transaction as FastSerializableTransaction;
  }

  // Already unwrapped (camelCase)
  if (isRecord(transaction) && typeof transaction.networkId === 'string') {
    return transaction as FastSerializableTransaction;
  }

  throw new Error('unsupported_fast_transaction_format');
}

export function serializeFastTransaction(transaction: VersionedFastTransaction | FastSerializableTransaction): Uint8Array {
  // Effect schema decoded form with camelCase keys — convert to BCS-compatible format
  if (isRecord(transaction) && typeof transaction.networkId === 'string') {
    const bcsCompatible = toBcsFormat(transaction) as Record<string, unknown>;
    return VersionedTransactionBcs.serialize({
      Release20260319: bcsCompatible,
    } as any).toBytes();
  }

  // RPC wire format: {Release20260319: {network_id: ..., ...}}
  if (isRecord(transaction) && 'Release20260319' in transaction && isRecord(transaction.Release20260319)) {
    return VersionedTransactionBcs.serialize({
      Release20260319: transaction.Release20260319,
    } as any).toBytes();
  }

  // Already unwrapped snake_case format
  return serializeVersionedTransaction(transaction as FastSerializableTransaction);
}

export function serializeVersionedTransaction(transaction: FastSerializableTransaction): Uint8Array {
  return VersionedTransactionBcs.serialize({
    Release20260319: transaction,
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

  if (isRecord(decoded) && 'Release20260319' in decoded) {
    return decoded.Release20260319 as unknown as DecodedFastTransaction;
  }

  return decoded as unknown as DecodedFastTransaction;
}

export function getTransferDetails(decoded: DecodedFastTransaction): TransferDetails | null {
  const claim = decoded.claim;
  if (!isRecord(claim)) return null;

  let transfer: Record<string, unknown> | null = null;

  // RPC wire format: {TokenTransfer: {...}}
  if ('TokenTransfer' in claim && isRecord(claim.TokenTransfer)) {
    transfer = claim.TokenTransfer as Record<string, unknown>;
  } else if ('Batch' in claim && Array.isArray(claim.Batch)) {
    for (const op of claim.Batch) {
      if (isRecord(op) && 'TokenTransfer' in op && isRecord(op.TokenTransfer)) {
        transfer = op.TokenTransfer as Record<string, unknown>;
        break;
      }
    }
  }

  if (!transfer) return null;

  const senderBytes = toUint8Array(decoded.sender);
  // Handle both snake_case (token_id) and camelCase (tokenId) keys
  const recipientBytes = toUint8Array(transfer.recipient);
  const tokenIdBytes = toUint8Array(transfer.token_id ?? transfer.tokenId);

  if (!senderBytes || !recipientBytes || !tokenIdBytes) {
    throw new Error('not_a_token_transfer');
  }

  const rawAmount = transfer.amount ?? transfer.value;
  const amount =
    typeof rawAmount === 'bigint'
      ? rawAmount
      : typeof rawAmount === 'number'
        ? BigInt(rawAmount)
        : typeof rawAmount === 'string'
          ? BigInt(rawAmount)
          : (() => {
              throw new Error('not_a_token_transfer');
            })();

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
