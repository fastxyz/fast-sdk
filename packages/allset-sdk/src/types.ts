import type { FastProvider, Signer } from '@fastxyz/sdk';
import type { Transaction, TransactionCertificate, VersionedTransaction } from '@fastxyz/schema';
import type { EvmClients } from './evm.js';
import type { Intent } from './intents.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface BridgeResult {
  txHash: string;
  orderId: string;
  estimatedTime?: string;
}

// ---------------------------------------------------------------------------
// executeDeposit params
// ---------------------------------------------------------------------------

export interface ExecuteDepositParams {
  /** EVM chain ID */
  chainId: number;
  /** AllSet bridge contract address on EVM */
  bridgeContract: `0x${string}`;
  /** ERC-20 token contract address on EVM (ignored when isNative is true) */
  tokenAddress: `0x${string}`;
  /** Set to true for native ETH deposits */
  isNative?: boolean;
  /** Amount in smallest units (e.g., '1000000' for 1 USDC) */
  amount: string;
  /** Receiver Fast address (fast1...) */
  receiverAddress: string;
  /** viem clients from createEvmExecutor() */
  evmClients: EvmClients;
}

// ---------------------------------------------------------------------------
// executeIntent params
// ---------------------------------------------------------------------------

export interface ExecuteIntentParams {
  /** AllSet bridge address on the Fast network (fast1...) */
  fastBridgeAddress: string;
  /** AllSet relayer URL for the destination EVM chain */
  relayerUrl: string;
  /** AllSet cross-sign service URL */
  crossSignUrl: string;
  /** Token contract address on EVM (used in relayer payload) */
  tokenEvmAddress: string;
  /** Token ID on the Fast network (hex string, without 0x) */
  tokenFastTokenId: string;
  /** Amount in smallest units (e.g., '1000000' for 1 USDC) */
  amount: string;
  /** Intents to execute on EVM chain after bridge */
  intents: Intent[];
  /**
   * EVM address for the relayer target.
   * Required when intents do not include a transfer recipient or execute target
   * (e.g., for buildDepositBackIntent or buildRevokeIntent flows).
   */
  externalAddress?: string;
  /** Deadline in seconds from now (default: 3600) */
  deadlineSeconds?: number;
  /** Ed25519 signer from @fastxyz/sdk */
  signer: Signer;
  /** Fast RPC provider from @fastxyz/sdk */
  provider: FastProvider;
  /** Fast network ID (e.g. 'fast:testnet', 'fast:mainnet') */
  networkId: string;
}

// ---------------------------------------------------------------------------
// executeWithdraw params
// ---------------------------------------------------------------------------

export interface ExecuteWithdrawParams {
  /** AllSet bridge address on the Fast network (fast1...) */
  fastBridgeAddress: string;
  /** AllSet relayer URL for the destination EVM chain */
  relayerUrl: string;
  /** AllSet cross-sign service URL */
  crossSignUrl: string;
  /** Token contract address on EVM */
  tokenEvmAddress: string;
  /** Token ID on the Fast network (hex string, without 0x) */
  tokenFastTokenId: string;
  /** Amount in smallest units (e.g., '1000000' for 1 USDC) */
  amount: string;
  /** EVM address to receive the withdrawn tokens */
  receiverEvmAddress: string;
  /** Deadline in seconds from now (default: 3600) */
  deadlineSeconds?: number;
  /** Ed25519 signer from @fastxyz/sdk */
  signer: Signer;
  /** Fast RPC provider from @fastxyz/sdk */
  provider: FastProvider;
  /** Fast network ID (e.g. 'fast:testnet', 'fast:mainnet') */
  networkId: string;
}

// ---------------------------------------------------------------------------
// Fast account client and signer types
// ---------------------------------------------------------------------------

export type FastTransaction = Transaction;
export type FastVersionedTransaction = VersionedTransaction;
export type FastTransactionCertificate = TransactionCertificate;

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

export interface FastPasskeyOwnerAuthorization {
  credential_id: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
  rp_id: string;
  origin?: string;
  challenge?: string;
  user_handle?: string | null;
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
  access_key_id: string;
  signature: number[];
  public_key?: number[];
  policy: FastDelegatedAccessKeyPolicy;
  issued_at?: string;
  key_manager?: FastKeyManagerContext;
  proof?: Record<string, unknown>;
}

export interface FastMultiSigConfig {
  authorized_signers: number[][];
  quorum: number;
  nonce: number;
}

export interface FastMultiSig {
  config: FastMultiSigConfig;
  signatures: Array<[number[], number[]]>;
}

export type FastEnvelopeSignature =
  | number[]
  | {
      Signature?: number[];
      MultiSig?: FastMultiSig;
      PasskeyOwner?: FastPasskeyOwnerAuthorization;
      DelegatedAccessKey?: FastDelegatedAccessKeyAuthorization;
    };

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

export interface FastPrepareTransactionOptions {
  claim: FastTransaction['claim'];
  nonce?: number;
  timestampNanos?: bigint;
  archival?: boolean;
  feeToken?: Uint8Array | number[] | null;
  networkId?: string;
}

export interface FastPreparedTransaction {
  address: string;
  transaction: FastVersionedTransaction;
  txHash: string;
  signingMessage: Uint8Array;
}

export interface FastPreparedTransactionAuthorization {
  preparedTransaction: FastPreparedTransaction;
  authorization: FastTransactionAuthorization;
}

export interface SendResult {
  txHash: string;
  certificate: FastTransactionCertificate;
  explorerUrl: string | null;
}

export interface SignResult {
  signature: string;
  address: string;
  messageBytes: string;
}

export interface SubmitResult {
  txHash: string;
  certificate: FastTransactionCertificate;
}
