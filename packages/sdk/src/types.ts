// /**
//  * types.ts — Fast SDK types
//  */

// import type { FastTransaction } from './encoding/types';

// export type FastNetworkId =
//   | 'fast:localnet'
//   | 'fast:devnet'
//   | 'fast:testnet'
//   | 'fast:mainnet';

// export interface DecodedFastAddress {
//   address: string;
//   bytes: Uint8Array;
// }

// /* ─────────────────────────────────────────────────────────────────────────────
//  * Provider Types
//  * ───────────────────────────────────────────────────────────────────────────── */

// /** Options for creating a FastProvider */
// export interface ProviderOptions {
//   /** RPC URL for the Fast proxy endpoint. Required. */
//   rpcUrl: string;
// }

// export interface FastNonceRange {
//   start: number;
//   limit: number;
// }

// export interface FastTokenMetadata {
//   update_id?: number;
//   admin?: number[];
//   token_name?: string;
//   decimals?: number;
//   total_supply?: string;
//   mints?: number[][];
// }

// export type FastVersionedTransaction =
//   | FastTransaction
//   | { Release20260319: FastTransaction };

// export interface FastMultiSigConfig {
//   authorized_signers: number[][];
//   quorum: number;
//   nonce: number;
// }

// export interface FastMultiSig {
//   config: FastMultiSigConfig;
//   signatures: Array<[number[], number[]]>;
// }

// export type FastEnvelopeSignature =
//   | number[]
//   | {
//       Signature?: number[];
//       MultiSig?: FastMultiSig;
//     };

// export interface FastTransactionEnvelope {
//   transaction: FastVersionedTransaction;
//   signature: FastEnvelopeSignature;
// }

// export interface FastTransactionCertificate {
//   envelope: FastTransactionEnvelope;
//   signatures: Array<[number[], number[]]>;
// }

// export type FastSubmitTransactionResult =
//   | { Success: FastTransactionCertificate }
//   | { IncompleteVerifierSigs: unknown[] }
//   | { IncompleteMultiSig: unknown[] };

// export interface FastValidatedTransaction {
//   value: FastTransactionEnvelope;
//   validator: number[];
//   signature: number[];
// }

// export type FastAccountInfo = {
//   sender?: number[];
//   balance?: string;
//   token_balance?: Array<[number[], string]>;
//   next_nonce?: number;
//   requested_state?: Array<[number[], number[]]>;
//   requested_certificates?: FastTransactionCertificate[];
//   requested_validated_transaction?: FastValidatedTransaction;
//   pending_confirmation?: FastValidatedTransaction;
// } | null;

// export interface FastTokenTransferSummary {
//   sender: string;
//   recipient: string;
//   tokenId: string;
//   amountHex: string;
//   amount?: string;
//   userData: string | null;
// }

export type BytesLike = Uint8Array | ArrayLike<number>;