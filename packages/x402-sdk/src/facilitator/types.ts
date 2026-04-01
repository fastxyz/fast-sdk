/**
 * x402-facilitator types
 * Aligned with reference implementation
 */

import type { Chain } from "viem";

/**
 * Payment requirement from the server
 */
export interface PaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
}

/**
 * Decoded X-PAYMENT payload
 */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown;
}

/**
 * Fast transaction certificate payload
 */
export interface FastPayload {
  transactionCertificate: {
    envelope: unknown;
    signatures: unknown[];
  };
}

/**
 * EVM EIP-3009 authorization payload
 */
export interface EvmPayload {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

/**
 * Verify response (matches reference: isValid, not valid)
 */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  network?: string;
}

/**
 * Settle response
 */
export interface SettleResponse {
  success: boolean;
  transaction?: string;
  txHash?: string;
  errorReason?: string;
  network?: string;
  payer?: string;
}

/**
 * Supported payment kind
 */
export interface SupportedPaymentKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

/**
 * Facilitator configuration
 */
export interface FacilitatorConfig {
  /** EVM private key for settling EIP-3009 authorizations */
  evmPrivateKey?: `0x${string}`;
  /** Fast RPC endpoint override used for Fast verification */
  fastRpcUrl?: string;
  /**
   * Trusted Fast committee public keys by network.
   * Values may be 32-byte hex strings or fast1.../set1... addresses.
   */
  committeePublicKeys?: Record<string, string[]>;
  /** Custom chain configs */
  chains?: Record<string, Chain>;
  /** Enable debug logging (default: true) */
  debug?: boolean;
}

/**
 * EVM chain configuration
 */
export interface EvmChainConfig {
  chain: Chain;
  rpcUrl?: string;
  usdcAddress: `0x${string}`;
  /** USDC contract name (for EIP-712 domain) */
  usdcName?: string;
  /** USDC contract version (for EIP-712 domain) */
  usdcVersion?: string;
}

/**
 * Network type
 */
export type NetworkType = "evm" | "fast" | "svm";

/**
 * Determine network type
 */
export function getNetworkType(network: string): NetworkType {
  if (network.startsWith("fast-")) {
    return "fast";
  }
  if (network.startsWith("solana")) {
    return "svm";
  }
  return "evm";
}

/**
 * Get chain ID from network name
 */
export function getNetworkId(network: string): number {
  const networkIds: Record<string, number> = {
    "ethereum": 1,
    "ethereum-sepolia": 11155111,
    "arbitrum": 42161,
    "arbitrum-sepolia": 421614,
    "base": 8453,
    "base-sepolia": 84532,
    "optimism": 10,
    "polygon": 137,
  };
  return networkIds[network] || 0;
}
