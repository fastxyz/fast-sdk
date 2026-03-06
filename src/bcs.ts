/**
 * bcs.ts — BCS schema definitions for Fast chain transactions
 *
 * Must match on-chain types exactly.
 */

import { bcs } from '@mysten/bcs';
import { keccak_256 } from '@noble/hashes/sha3';

// ---------------------------------------------------------------------------
// BCS Type Definitions
// ---------------------------------------------------------------------------

const AmountBcs = bcs.u256().transform({
  input: (val: string) => BigInt(`0x${val}`).toString(),
});

const TokenTransferBcs = bcs.struct('TokenTransfer', {
  token_id: bcs.bytes(32),
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
  StateInitialization: bcs.struct('StateInitialization', { dummy: bcs.u8() }),
  StateUpdate: bcs.struct('StateUpdate', { dummy: bcs.u8() }),
  ExternalClaim: ExternalClaimFullBcs,
  StateReset: bcs.struct('StateReset', { dummy: bcs.u8() }),
  JoinCommittee: bcs.struct('JoinCommittee', { dummy: bcs.u8() }),
  LeaveCommittee: bcs.struct('LeaveCommittee', { dummy: bcs.u8() }),
  ChangeCommittee: bcs.struct('ChangeCommittee', { dummy: bcs.u8() }),
  Batch: bcs.vector(
    bcs.enum('Operation', {
      TokenTransfer: bcs.struct('TokenTransferOperation', {
        token_id: bcs.bytes(32),
        recipient: bcs.bytes(32),
        amount: AmountBcs,
        user_data: bcs.option(bcs.bytes(32)),
      }),
      TokenCreation: TokenCreationBcs,
      TokenManagement: TokenManagementBcs,
      Mint: bcs.struct('MintOperation', {
        token_id: bcs.bytes(32),
        recipient: bcs.bytes(32),
        amount: AmountBcs,
      }),
    }),
  ),
});

export const TransactionBcs = bcs.struct('Transaction', {
  sender: bcs.bytes(32),
  recipient: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: ClaimTypeBcs,
  archival: bcs.bool(),
});

// ---------------------------------------------------------------------------
// Transaction type — inferred from TransactionBcs struct
// ---------------------------------------------------------------------------

export type FastTransaction = Parameters<typeof TransactionBcs.serialize>[0];

// ---------------------------------------------------------------------------
// Transaction hashing: keccak256(BCS(transaction))
// ---------------------------------------------------------------------------

export function hashTransaction(transaction: FastTransaction): string {
  const serialized = TransactionBcs.serialize(transaction).toBytes();
  const hash = keccak_256(serialized);
  return `0x${Buffer.from(hash).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FAST_DECIMALS = 18;

/** Native SET token ID: [0xfa, 0x57, 0x5e, 0x70, 0, 0, ..., 0] */
export const SET_TOKEN_ID = new Uint8Array(32);
SET_TOKEN_ID.set([0xfa, 0x57, 0x5e, 0x70], 0);

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
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const padded = clean.padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
