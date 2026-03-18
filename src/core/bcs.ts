/**
 * bcs.ts — BCS schema definitions for Fast transactions
 *
 * Must match on-network types exactly.
 */

import { bcs } from '@mysten/bcs';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  bytesToPrefixedHex,
  hexToBytes as decodeHexToBytes,
  stripHexPrefix,
} from './bytes.js';
import type { FastNetworkId } from './types.js';

// ---------------------------------------------------------------------------
// BCS Type Definitions
// ---------------------------------------------------------------------------

const AmountBcs = bcs.u256().transform({
  input: (val: string) => BigInt(`0x${val}`).toString(),
});

export const FAST_NETWORK_IDS = {
  LOCALNET: 'fast:localnet',
  DEVNET: 'fast:devnet',
  TESTNET: 'fast:testnet',
  MAINNET: 'fast:mainnet',
} as const satisfies Record<string, FastNetworkId>;

const TokenTransferBcs = bcs.struct('TokenTransfer', {
  token_id: bcs.bytes(32),
  recipient: bcs.bytes(32),
  amount: AmountBcs,
  user_data: bcs.option(bcs.bytes(32)),
});

const TokenCreationBcs = bcs.struct('TokenCreation', {
  token_name: bcs.string(),
  decimals: bcs.u8(),
  initial_amount: AmountBcs,
  mints: bcs.vector(bcs.bytes(32)),
  user_data: bcs.option(bcs.bytes(32)),
});

const AddressChangeBcs = bcs.enum('AddressChange', {
  Add: bcs.tuple([]),
  Remove: bcs.tuple([]),
});

const TokenManagementBcs = bcs.struct('TokenManagement', {
  token_id: bcs.bytes(32),
  update_id: bcs.u64(),
  new_admin: bcs.option(bcs.bytes(32)),
  mints: bcs.vector(bcs.tuple([AddressChangeBcs, bcs.bytes(32)])),
  user_data: bcs.option(bcs.bytes(32)),
});

const MintBcs = bcs.struct('Mint', {
  token_id: bcs.bytes(32),
  recipient: bcs.bytes(32),
  amount: AmountBcs,
});

const BurnBcs = bcs.struct('Burn', {
  token_id: bcs.bytes(32),
  amount: AmountBcs,
});

const ExternalClaimBodyBcs = bcs.struct('ExternalClaimBody', {
  verifier_committee: bcs.vector(bcs.bytes(32)),
  verifier_quorum: bcs.u64(),
  claim_data: bcs.vector(bcs.u8()),
});

const ExternalClaimFullBcs = bcs.struct('ExternalClaimFull', {
  claim: ExternalClaimBodyBcs,
  signatures: bcs.vector(bcs.tuple([bcs.bytes(32), bcs.bytes(64)])),
});

const ClaimTypeBcs = bcs.enum('ClaimType', {
  TokenTransfer: TokenTransferBcs,
  TokenCreation: TokenCreationBcs,
  TokenManagement: TokenManagementBcs,
  Mint: MintBcs,
  Burn: BurnBcs,
  StateInitialization: bcs.struct('StateInitialization', { dummy: bcs.u8() }),
  StateUpdate: bcs.struct('StateUpdate', { dummy: bcs.u8() }),
  ExternalClaim: ExternalClaimFullBcs,
  StateReset: bcs.struct('StateReset', { dummy: bcs.u8() }),
  JoinCommittee: bcs.struct('JoinCommittee', { dummy: bcs.u8() }),
  LeaveCommittee: bcs.struct('LeaveCommittee', { dummy: bcs.u8() }),
  ChangeCommittee: bcs.struct('ChangeCommittee', { dummy: bcs.u8() }),
  Batch: bcs.vector(
    bcs.enum('Operation', {
      TokenTransfer: TokenTransferBcs,
      TokenCreation: TokenCreationBcs,
      TokenManagement: TokenManagementBcs,
      Mint: MintBcs,
    }),
  ),
});

export const TransactionBcs = bcs.struct('Transaction', {
  network_id: bcs.string(),
  sender: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: ClaimTypeBcs,
  archival: bcs.bool(),
  fee_token: bcs.option(bcs.bytes(32)),
});

/**
 * Versioned transaction envelope for parsing/decoding.
 * Use for decoding certificates received from the network.
 */
export const VersionedTransactionBcs = bcs.enum('VersionedTransaction', {
  Release20260319: TransactionBcs,
});

// ---------------------------------------------------------------------------
// Transaction type — inferred from TransactionBcs struct
// ---------------------------------------------------------------------------

export type FastTransaction = Parameters<typeof TransactionBcs.serialize>[0];
export type VersionedTransaction = Parameters<typeof VersionedTransactionBcs.serialize>[0];

/**
 * Serialize a transaction as VersionedTransaction::Release20260319.
 */
export function serializeVersionedTransaction(transaction: FastTransaction): Uint8Array {
  return VersionedTransactionBcs.serialize({ Release20260319: transaction }).toBytes();
}

// ---------------------------------------------------------------------------
// Transaction hashing: keccak256(BCS(VersionedTransaction::Release20260319(tx)))
// ---------------------------------------------------------------------------

export function hashTransaction(transaction: FastTransaction): string {
  const serialized = serializeVersionedTransaction(transaction);
  const hash = keccak_256(serialized);
  return bytesToPrefixedHex(hash);
}

// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------

/**
 * Decoded transaction details (simplified for verification)
 */
export interface DecodedTransaction {
  network_id: FastNetworkId;
  sender: Uint8Array;
  nonce: bigint;
  timestamp_nanos: bigint;
  claim: {
    TokenTransfer?: {
      token_id: Uint8Array;
      recipient: Uint8Array;
      amount: string;
      user_data: Uint8Array | null;
    };
    [key: string]: unknown;
  };
  archival: boolean;
  fee_token: Uint8Array | null;
}

/**
 * Convert bytes to hex string (with 0x prefix)
 */
export function bytesToHex(bytes: Uint8Array | number[]): string {
  return bytesToPrefixedHex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  return decodeHexToBytes(stripHexPrefix(hex));
}

/**
 * Decode a Fast transaction envelope.
 *
 * Supports both versioned Release20260319 bytes and bare current transaction bytes.
 *
 * @param envelope - Hex string, number array, or Uint8Array
 * @returns Decoded transaction details
 */
export function decodeTransactionEnvelope(
  envelope: string | number[] | Uint8Array
): DecodedTransaction {
  let bytes: Uint8Array;

  if (typeof envelope === 'string') {
    bytes = hexToBytes(envelope);
  } else if (Array.isArray(envelope)) {
    bytes = new Uint8Array(envelope);
  } else if (envelope instanceof Uint8Array) {
    bytes = envelope;
  } else {
    throw new Error(`Invalid envelope type: ${typeof envelope}`);
  }

  // Try versioned first, then fall back to a bare current transaction encoding.
  let decoded: FastTransaction;
  try {
    const versioned = VersionedTransactionBcs.parse(bytes);
    if (versioned && typeof versioned === 'object' && 'Release20260319' in versioned) {
      decoded = (versioned as { Release20260319: FastTransaction }).Release20260319;
    } else {
      throw new Error('Unknown versioned format');
    }
  } catch {
    decoded = TransactionBcs.parse(bytes);
  }

  // Extract claim details
  const claim: DecodedTransaction['claim'] = {};

  if (decoded.claim && typeof decoded.claim === 'object') {
    const claimObj = decoded.claim as Record<string, unknown>;

    if ('TokenTransfer' in claimObj) {
      const tt = claimObj.TokenTransfer as {
        token_id: Iterable<number>;
        recipient: Iterable<number>;
        amount: string;
        user_data: Iterable<number> | null;
      };
      claim.TokenTransfer = {
        token_id: new Uint8Array(tt.token_id),
        recipient: new Uint8Array(tt.recipient),
        amount: tt.amount,
        user_data: tt.user_data ? new Uint8Array(tt.user_data) : null,
      };
    }

    // Copy other claim types as-is
    for (const [key, value] of Object.entries(claimObj)) {
      if (key !== 'TokenTransfer') {
        claim[key] = value;
      }
    }
  }

  return {
    network_id: decoded.network_id as FastNetworkId,
    sender: new Uint8Array(decoded.sender as Iterable<number>),
    nonce: BigInt(decoded.nonce),
    timestamp_nanos: BigInt(decoded.timestamp_nanos),
    claim,
    archival: decoded.archival,
    fee_token: decoded.fee_token ? new Uint8Array(decoded.fee_token as Iterable<number>) : null,
  };
}

/**
 * Extract transfer details from a decoded transaction
 *
 * @param tx - Decoded transaction
 * @returns Transfer details or null if not a TokenTransfer
 */
export function getTransferDetails(tx: DecodedTransaction): {
  sender: string;
  recipient: string;
  amount: bigint;
  tokenId: string;
} | null {
  if (!tx.claim.TokenTransfer) {
    return null;
  }

  const tt = tx.claim.TokenTransfer;
  const amount = BigInt(tt.amount);

  return {
    sender: bytesToHex(tx.sender),
    recipient: bytesToHex(tt.recipient),
    amount,
    tokenId: bytesToHex(tt.token_id),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FAST_DECIMALS = 18;

/** Native FAST token ID: [0xfa, 0x57, 0x5e, 0x70, 0, 0, ..., 0] */
export const FAST_TOKEN_ID = new Uint8Array(32);
FAST_TOKEN_ID.set([0xfa, 0x57, 0x5e, 0x70], 0);

export const EXPLORER_BASE = 'https://explorer.fastset.xyz/txs';

// ---------------------------------------------------------------------------
// Token ID helpers
// ---------------------------------------------------------------------------

/** Compare two token ID byte arrays for equality */
export function tokenIdEquals(a: number[] | Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Parse a hex string (with or without 0x prefix) into a 32-byte token ID */
export function hexToTokenId(hex: string): Uint8Array {
  const clean = stripHexPrefix(hex);
  const padded = clean.padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
