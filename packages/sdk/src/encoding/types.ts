import type { InferBcsInput } from '@mysten/bcs';
import type { FastNetworkId } from '../types';
import * as schemas from './schema';

export type PublicKeyBytes = InferBcsInput<typeof schemas.PublicKeyBytes>;
export type Nonce = InferBcsInput<typeof schemas.Nonce>;
export type TimestampNanos = InferBcsInput<typeof schemas.TimestampNanos>;
export type TokenId = InferBcsInput<typeof schemas.TokenId>;
export type TokenName = InferBcsInput<typeof schemas.TokenName>;
export type TokenDecimals = InferBcsInput<typeof schemas.TokenDecimals>;
export type Amount = InferBcsInput<typeof schemas.Amount>;
export type UserData = InferBcsInput<typeof schemas.UserData>;
export type State = InferBcsInput<typeof schemas.State>;
export type Quorum = InferBcsInput<typeof schemas.Quorum>;
export type ClaimData = InferBcsInput<typeof schemas.ClaimData>;
export type Signature = InferBcsInput<typeof schemas.Signature>;

export type AddressChange = InferBcsInput<typeof schemas.AddressChange>;
export type TokenTransfer = InferBcsInput<typeof schemas.TokenTransfer>;
export type TokenCreation = InferBcsInput<typeof schemas.TokenCreation>;
export type TokenManagement = InferBcsInput<typeof schemas.TokenManagement>;
export type Mint = InferBcsInput<typeof schemas.Mint>;
export type Burn = InferBcsInput<typeof schemas.Burn>;
export type StateInitialization = InferBcsInput<typeof schemas.StateInitialization>;
export type StateUpdate = InferBcsInput<typeof schemas.StateUpdate>;
export type ExternalClaimBody = InferBcsInput<typeof schemas.ExternalClaimBody>;
export type VerifierSig = InferBcsInput<typeof schemas.VerifierSig>;
export type ExternalClaim = InferBcsInput<typeof schemas.ExternalClaim>;
export type StateReset = InferBcsInput<typeof schemas.StateReset>;
export type ClaimType = InferBcsInput<typeof schemas.ClaimType>;

type RawTransaction20260319 = InferBcsInput<typeof schemas.Transaction20260319>;
export type Transaction20260319 = Omit<RawTransaction20260319, 'network_id'> & {
	network_id: FastNetworkId;
};

type RawVersionedTransaction = InferBcsInput<typeof schemas.VersionedTransaction>;
export type VersionedTransaction = {
	[K in keyof RawVersionedTransaction]: RawVersionedTransaction[K] extends { network_id: unknown }
		? Omit<RawVersionedTransaction[K], 'network_id'> & { network_id: FastNetworkId }
		: RawVersionedTransaction[K];
};



