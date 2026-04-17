import { Schema } from 'effect';
import { Int320, Uint8Array32, Uint8Array64, Uint64, Uint256 } from '../util/index.ts';

/** Unsigned 256-bit integer. Represents token amounts. */
export const Amount = Uint256.pipe(Schema.brand('Amount'));

/** Signed 320-bit integer (Rust `BInt<5>`). Represents account balances. */
export const Balance = Int320.pipe(Schema.brand('Balance'));

/** u64 transaction sequence number. */
export const Nonce = Uint64.pipe(Schema.brand('Nonce'));

/** u64 signature quorum threshold. */
export const Quorum = Uint64.pipe(Schema.brand('Quorum'));

/** Known network identifier. */
export const NetworkId = Schema.Literal('fast:localnet', 'fast:devnet', 'fast:testnet', 'fast:mainnet');
export type NetworkId = typeof NetworkId.Type;

export const TransactionVersion = Schema.Literal('Release20260319', 'Release20260407');
export type TransactionVersion = typeof TransactionVersion.Type;

/** All transaction versions supported by this schema release. */
export const SupportedTransactionVersions = TransactionVersion.literals;

/** The latest transaction version — used as the default throughout the SDK. */
export const LatestTransactionVersion: TransactionVersion = 'Release20260407';

/** 32-byte Ed25519 public key. */
export const Address = Uint8Array32.pipe(Schema.brand('Address'));

/** 64-byte Ed25519 signature. */
export const Signature = Uint8Array64.pipe(Schema.brand('Signature'));

/** 32-byte token identifier. */
export const TokenId = Uint8Array32.pipe(Schema.brand('TokenId'));

/** 32-byte state key. */
export const StateKey = Uint8Array32.pipe(Schema.brand('StateKey'));

/** 32-byte state value. */
export const State = Uint8Array32.pipe(Schema.brand('State'));

/** Variable-length binary claim data. */
export const ClaimData = Schema.Uint8ArrayFromSelf.pipe(Schema.brand('ClaimData'));

/** Optional 32-byte user data. */
export const UserData = Schema.NullOr(Uint8Array32.pipe(Schema.brand('UserData')));
