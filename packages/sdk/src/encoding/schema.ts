import { bcs } from '@mysten/bcs';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToPrefixedHex } from '../bytes';
import type { VersionedTransaction as IVersionedTransaction } from './types';

export const PublicKeyBytes = bcs.fixedArray(32, bcs.u8());
export const Nonce = bcs.u64();
export const TimestampNanos = bcs.u128();
export const TokenId = bcs.fixedArray(32, bcs.u8());
export const TokenName = bcs.string();
export const TokenDecimals = bcs.u8();
export const Amount = bcs.u256();
export const UserData = bcs.option(bcs.fixedArray(32, bcs.u8()));
export const State = bcs.fixedArray(32, bcs.u8());
export const Quorum = bcs.u64();
export const ClaimData = bcs.vector(bcs.u8());
export const Signature = bcs.fixedArray(64, bcs.u8());

export const AddressChange = bcs.enum('AddressChange', {
    Add: bcs.tuple([]),
    Remove: bcs.tuple([]),
});

export const TokenTransfer = bcs.struct('TokenTransfer', {
    token_id: TokenId,
    recipient: PublicKeyBytes,
    amount: Amount,
    user_data: UserData,
});

export const TokenCreation = bcs.struct('TokenCreation', {
    token_name: TokenName,
    decimals: TokenDecimals,
    initial_amount: Amount,
    mints: bcs.vector(PublicKeyBytes),
    user_data: UserData,
});

export const TokenManagement = bcs.struct('TokenManagement', {
    token_id: TokenId,
    update_id: Nonce,
    new_admin: bcs.option(PublicKeyBytes),
    mints: bcs.vector(bcs.tuple([AddressChange, PublicKeyBytes])),
    user_data: UserData,
});

export const Mint = bcs.struct('Mint', {
    token_id: TokenId,
    recipient: PublicKeyBytes,
    amount: Amount,
});

export const Burn = bcs.struct('Burn', {
    token_id: TokenId,
    amount: Amount,
});

export const StateInitialization = bcs.struct('StateInitialization', {
    initial_state: State,
});

export const StateUpdate = bcs.struct('StateUpdate', {
    previous_state: State,
    next_state: State,
    compute_claim_tx_hash: bcs.fixedArray(32, bcs.u8()),
    compute_claim_tx_timestamp: TimestampNanos,
});

export const ExternalClaimBody = bcs.struct('ExternalClaimBody', {
    verifier_committee: bcs.vector(PublicKeyBytes),
    verifier_quorum: Quorum,
    claim_data: ClaimData,
});

export const VerifierSig = bcs.struct('VerifierSig', {
    verifier_addr: PublicKeyBytes,
    sig: Signature,
});

export const ExternalClaim = bcs.struct('ExternalClaim', {
    claim: ExternalClaimBody,
    signatures: bcs.vector(VerifierSig),
});

export const StateReset = bcs.struct('StateReset', {
    reset_state: State,
});

export const ClaimType = bcs.enum('ClaimType', {
    TokenTransfer: TokenTransfer,
    TokenCreation: TokenCreation,
    TokenManagement: TokenManagement,
    Mint: Mint,
    Burn: Burn,
    StateInitialization: StateInitialization,
    StateUpdate: StateUpdate,
    ExternalClaim: ExternalClaim,
    StateReset: StateReset,
});

export const TRANSACTION_VERSION_20260319 = 'Release20260319' as const;

export const Transaction20260319 = bcs.struct('Transaction', {
    network_id: bcs.string(),
    sender: PublicKeyBytes,
    nonce: Nonce,
    timestamp_nanos: TimestampNanos,
    claim: ClaimType,
    archival: bcs.bool(),
    fee_token: bcs.option(TokenId),
});

export const VersionedTransaction = bcs.enum('VersionedTransaction', {
    [TRANSACTION_VERSION_20260319]: Transaction20260319,
});

export function serializeVersionedTransaction(tx: IVersionedTransaction): Uint8Array {
    return VersionedTransaction.serialize(tx).toBytes();
}

export function hashTransaction(tx: IVersionedTransaction): string {
    return bytesToPrefixedHex(keccak_256(serializeVersionedTransaction(tx)));
}