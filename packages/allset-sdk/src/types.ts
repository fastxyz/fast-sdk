import type { EvmClients } from './evm-executor.js';
import type { Intent } from './intents.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface FastWalletLike {
  /** Sender Fast address (fast1...) */
  readonly address: string;
  submit(params: {
    claim: Record<string, unknown>;
  }): Promise<{
    txHash: string;
    certificate: unknown;
  }>;
}

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
  /** Sender EVM address (0x...) */
  senderAddress: string;
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
  /** Fast wallet to sign transactions */
  fastWallet: FastWalletLike;
}
