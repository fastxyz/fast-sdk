/**
 * x402 Client Types
 */

import type { NetworkId } from '@fastxyz/schema';

// Re-export shared types from x402-types
export type {
  PaymentRequirement,
  PaymentPayload,
  EvmPayload,
  FastPayload,
  VerifyResponse,
  SettleResponse,
  EvmChainConfig,
  FastNetworkConfig,
} from '@fastxyz/x402-types';

/**
 * Parsed 402 response
 */
export interface PaymentRequired {
  x402Version?: number;
  accepts?: PaymentRequirement[];
}

/**
 * Minimal payment requirement fields used by the client when matching
 * networks from a 402 response.  The server sends the full
 * PaymentRequirement, but the client only inspects a subset.
 */
export interface ClientPaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset?: string;
  extra?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
}

/**
 * Fast wallet configuration
 */
export interface FastWallet {
  type: 'fast';
  privateKey: string;
  publicKey: string;
  address: string;
  /** Fast RPC endpoint — required */
  rpcUrl: string;
}

/**
 * EVM wallet configuration
 */
export interface EvmWallet {
  type: 'evm';
  privateKey: `0x${string}`;
  address: `0x${string}`;
}

/**
 * Combined wallet type
 */
export type Wallet = FastWallet | EvmWallet;

/**
 * Bridge configuration for auto-bridge from Fast to EVM.
 */
export interface BridgeConfig {
  rpcUrl: string;
  fastBridgeAddress: string;
  relayerUrl: string;
  crossSignUrl: string;
  tokenEvmAddress: string;
  tokenFastTokenId: string;
  /** Fast network ID for allset-sdk (e.g. 'fast:testnet') */
  networkId: NetworkId;
}

/**
 * x402Pay parameters
 */
export interface X402PayParams {
  /** URL of the x402-protected resource */
  url: string;
  /** HTTP method (default: GET) */
  method?: string;
  /** Custom headers to include in the request */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT) */
  body?: string;
  /** Wallet(s) to use for payment */
  wallet: Wallet | Wallet[];
  /** EVM network configs keyed by network name (e.g. "arbitrum" → config) */
  evmNetworks?: Record<string, EvmChainConfig>;
  /** Bridge configuration for auto-bridge from Fast to EVM */
  bridgeConfig?: BridgeConfig;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Payment details in response
 */
export interface PaymentDetails {
  network: string;
  amount: string;
  recipient: string;
  txHash: string;
  bridged?: boolean;
  bridgeTxHash?: string;
}

/**
 * x402Pay response
 */
export interface X402PayResult {
  success: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  payment?: PaymentDetails;
  note: string;
  logs?: string[];
}

/**
 * EIP-3009 authorization parameters
 */
export interface Eip3009Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

import type { PaymentRequirement, EvmChainConfig } from '@fastxyz/x402-types';
