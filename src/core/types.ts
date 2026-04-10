/**
 * types.ts — Fast SDK types
 */

import type { FastTransaction } from './bcs.js';

/** Network names. Built-in networks are `testnet` and `mainnet`, but custom names are allowed. */
type BuiltinNetworkType = 'testnet' | 'mainnet';
export type NetworkType = BuiltinNetworkType | (string & {});
export type FastNetworkId =
  | 'fast:localnet'
  | 'fast:devnet'
  | 'fast:testnet'
  | 'fast:mainnet';

export interface NetworkInfo {
  rpc: string;
  explorer?: string;
  networkId?: FastNetworkId;
}

export interface KnownFastToken {
  symbol: string;
  tokenId: string;
  decimals: number;
}

export interface DecodedFastAddress {
  address: string;
  bytes: Uint8Array;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Provider Types
 * ───────────────────────────────────────────────────────────────────────────── */

/** Options for creating a FastProvider */
export interface ProviderOptions {
  /** Network to connect to (default: 'testnet'). Can be a custom name from ~/.fast/networks.json. */
  network?: NetworkType;
  /** Explicit CAIP-2 Fast network id to sign transactions against. */
  networkId?: FastNetworkId;
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Custom explorer URL (overrides network default) */
  explorerUrl?: string;
  /** In-memory network metadata overrides, primarily for browser and test environments. */
  networks?: Record<string, NetworkInfo>;
  /** In-memory token metadata overrides, primarily for browser and test environments. */
  tokens?: Record<string, KnownFastToken>;
}

/** Token info returned by provider queries */
export interface TokenInfo {
  name: string;
  symbol: string;
  tokenId: string;
  decimals: number;
  totalSupply?: string;
  admin?: string;
  minters?: string[];
}

/** Token balance entry */
export interface TokenBalance {
  symbol: string;
  tokenId: string;
  balance: string;
  decimals: number;
}

export interface FastNonceRange {
  start: number;
  end: number;
}

export interface FastTokenMetadata {
  update_id?: number;
  admin?: number[];
  token_name?: string;
  decimals?: number;
  total_supply?: string;
  mints?: number[][];
}

export type FastVersionedTransaction =
  | FastTransaction
  | { Release20260319: FastTransaction };

export interface FastMultiSigConfig {
  authorized_signers: number[][];
  quorum: number;
  nonce: number;
}

export interface FastMultiSig {
  config: FastMultiSigConfig;
  signatures: Array<[number[], number[]]>;
}

export interface FastPasskeyOwnerConfig {
  credential_id: number[];
  rp_id: string;
  origin: string;
  public_key_x: number[];
  public_key_y: number[];
}

export interface FastPasskeyOwnerAuthorization {
  config: FastPasskeyOwnerConfig;
  authenticator_data: number[];
  client_data_json: number[];
  signature: number[];
}

export interface FastDelegatedAccessKeyPolicy {
  client_id: string;
  expires_at?: string | null;
  allowed_operations?: string[];
  allowed_tokens?: string[];
  max_total_spend?: string | null;
  remaining_spend?: string | null;
  session_id?: string | null;
  revoked?: boolean;
}

export interface FastKeyManagerContext {
  mode?: 'local' | 'remote' | 'hybrid';
  key_id?: string;
  session_id?: string;
  service?: string;
}

export interface FastDelegatedAccessKeyAuthorization {
  access_key_id: number[];
  delegate: number[];
  client_id: string;
  signature: number[];
  issued_at?: string;
  key_manager?: FastKeyManagerContext;
  proof?: Record<string, unknown>;
}

export type FastEnvelopeSignature =
  | number[]
  | {
      Signature?: number[];
      MultiSig?: FastMultiSig;
      PasskeyOwner?: FastPasskeyOwnerAuthorization;
      DelegatedAccessKey?: FastDelegatedAccessKeyAuthorization;
    };

export interface FastTransactionEnvelope {
  transaction: FastVersionedTransaction;
  signature: FastEnvelopeSignature;
}

export interface FastTransactionCertificate {
  envelope: FastTransactionEnvelope;
  signatures: Array<[number[], number[]]>;
}

export type FastSubmitTransactionResult =
  | { Success: FastTransactionCertificate }
  | { IncompleteVerifierSigs: unknown[] }
  | { IncompleteMultiSig: unknown[] };

export type FastAccountInfo = {
  balance?: string;
  token_balance?: Array<[number[], string]>;
  next_nonce?: number;
  requested_certificates?: FastTransactionCertificate[];
} | null;

export interface FastTokenTransferSummary {
  sender: string;
  recipient: string;
  tokenId: string;
  amountHex: string;
  amount?: string;
  userData: string | null;
}

export type FastTransactionClaim = FastTransaction['claim'];

export interface FastPrepareTransactionOptions {
  claim: FastTransactionClaim;
  nonce?: number;
  timestampNanos?: bigint;
  archival?: boolean;
  feeToken?: Uint8Array | number[] | null;
}

export interface FastPreparedTransaction {
  address: string;
  transaction: FastTransaction;
  txHash: string;
  signingMessage: Uint8Array;
}

export interface FastPreparedTransactionAuthorization {
  preparedTransaction: FastPreparedTransaction;
  authorization: FastTransactionAuthorization;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Wallet Types
 * ───────────────────────────────────────────────────────────────────────────── */

/** Options for creating a FastWallet from keyfile */
export interface WalletKeyfileOptions {
  /** Path to keyfile (default: ~/.fast/keys/default.json) */
  keyFile?: string;
  /** Named key - resolves to ~/.fast/keys/{key}.json */
  key?: string;
  /** Create new key if keyfile doesn't exist (default: true) */
  createIfMissing?: boolean;
}

/** Result of a send operation */
export interface SendResult {
  txHash: string;
  certificate: FastTransactionCertificate;
  explorerUrl: string | null;
}

/** Result of a sign operation */
export interface SignResult {
  signature: string;
  address: string;
  messageBytes: string;
}

/** Result of a submit operation */
export interface SubmitResult {
  txHash: string;
  certificate: FastTransactionCertificate;
}

/** Exported wallet keys (never includes private key) */
export interface ExportedKeys {
  publicKey: string;
  address: string;
}

export type FastSignerKind =
  | 'ed25519'
  | 'passkey-owner'
  | 'delegated-access-key'
  | 'remote';

export type FastSignerRole = 'owner' | 'delegated';

export type FastSignerOrigin = 'local' | 'non-extractable' | 'remote' | 'hybrid';

export interface FastSignerCapabilities {
  kind: FastSignerKind;
  role: FastSignerRole;
  origin: FastSignerOrigin;
  canSignMessages: boolean;
  canAuthorizeTransactions: boolean;
}

export interface FastSignerDescriptor {
  address: string;
  publicKey?: Uint8Array | null;
  capabilities: FastSignerCapabilities;
  metadata?: Record<string, unknown>;
}

export interface FastTransactionAuthorization {
  address: string;
  signature: FastEnvelopeSignature;
  capabilities: FastSignerCapabilities;
  metadata?: Record<string, unknown>;
}

export interface FastAccountIdentity {
  address: string;
  publicKey?: string | null;
  signer: FastSignerCapabilities;
  metadata?: Record<string, unknown>;
}
