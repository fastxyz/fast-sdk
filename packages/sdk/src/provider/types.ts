import type { VersionedTransaction } from '../encoding/types';
import type { BytesLike } from '../types';

export type FastSetAddress = number[];
export type FastTokenId = number[];
export type FastStateKey = number[];
export type FastState = number[];
export type FastSignature = number[];
export type FastAmount = string;
export type FastBalance = string;

export interface ProviderOptions {
  rpcUrl: string;
}

export interface FastNonceRange {
  start: number;
  limit: number;
}

export interface FastTokenMetadata {
  update_id: number;
  admin: FastSetAddress;
  token_name: string;
  decimals: number;
  total_supply: string;
  mints: FastSetAddress[];
}

export interface FastMultiSigConfig {
  authorized_signers: FastSetAddress[];
  quorum: number;
  nonce: number;
}

export interface FastMultiSig {
  config: FastMultiSigConfig;
  signatures: Array<[FastSetAddress, FastSignature]>;
}

export interface FastMultiSigInput {
  config: FastMultiSigConfig;
  signatures: Array<[BytesLike, BytesLike]>;
}

export type FastSignatureOrMultiSig =
  | { Signature: FastSignature }
  | { MultiSig: FastMultiSig };

export type FastSignatureOrMultiSigInput =
  | BytesLike
  | { Signature: BytesLike }
  | { MultiSig: FastMultiSigInput };

export interface FastTransactionEnvelope {
  transaction: VersionedTransaction;
  signature: FastSignatureOrMultiSig;
}

export interface FastTransactionEnvelopeInput {
  transaction: VersionedTransaction;
  signature: FastSignatureOrMultiSigInput;
}

export interface FastTransactionCertificate {
  envelope: FastTransactionEnvelope;
  signatures: Array<[FastSetAddress, FastSignature]>;
}

export type FastSubmitTransactionResult =
  | { Success: FastTransactionCertificate }
  | { IncompleteVerifierSigs: unknown[] }
  | { IncompleteMultiSig: unknown[] };

export interface FastValidatedTransaction {
  value: FastTransactionEnvelope;
  validator: FastSetAddress;
  signature: FastSignature;
}

export interface FastAccountInfo {
  sender: FastSetAddress;
  balance: FastBalance;
  next_nonce: number;
  pending_confirmation?: FastValidatedTransaction;
  requested_state: Array<[FastStateKey, FastState]>;
  requested_certificates?: FastTransactionCertificate[] | null;
  requested_validated_transaction?: FastValidatedTransaction;
  token_balance: Array<[FastTokenId, FastBalance]>;
}

export interface FastTokenInfoResponse {
  requested_token_metadata: Array<[FastTokenId, FastTokenMetadata]>;
}

export interface FaucetDripParams {
  recipient: string | BytesLike;
  amount: string;
  tokenId?: string | BytesLike | null;
}

export interface GetAccountInfoParams {
  address: string | BytesLike;
  tokenBalancesFilter?: Array<string | BytesLike> | null;
  stateKeyFilter?: Array<string | BytesLike> | null;
  certificateByNonce?: FastNonceRange | null;
}
