/**
 * x402-facilitator types
 *
 * Re-exports shared types from x402-types and defines facilitator-specific types.
 */

import type { Chain } from 'viem';

export type {
  PaymentRequirement,
  PaymentPayload,
  FastPayload,
  EvmPayload,
  VerifyResponse,
  SettleResponse,
  SupportedPaymentKind,
  NetworkType,
} from '@fastxyz/x402-types';

export { getNetworkType } from '@fastxyz/x402-types';

/**
 * EVM chain config for the facilitator.
 * Extends x402-types EvmChainConfig with the viem Chain object
 * needed for on-chain verification and settlement.
 */
export interface FacilitatorEvmChainConfig {
  chain: Chain;
  rpcUrl?: string;
  usdcAddress: `0x${string}`;
  /** USDC contract name (for EIP-712 domain) */
  usdcName?: string;
  /** USDC contract version (for EIP-712 domain) */
  usdcVersion?: string;
}

/**
 * Fast network config for the facilitator.
 */
export interface FacilitatorFastNetworkConfig {
  rpcUrl: string;
  /**
   * Trusted committee public keys for this network.
   * Values may be 32-byte hex strings or fast1.../set1... addresses.
   */
  committeePublicKeys: string[];
}

/**
 * Facilitator configuration.
 * All network configs provided by the caller — no hardcoded defaults.
 */
export interface FacilitatorConfig {
  /** EVM private key for settling EIP-3009 authorizations */
  evmPrivateKey?: `0x${string}`;
  /** EVM chain configs keyed by network name */
  evmChains?: Record<string, FacilitatorEvmChainConfig>;
  /** Fast network configs keyed by network name */
  fastNetworks?: Record<string, FacilitatorFastNetworkConfig>;
  /** Enable debug logging (default: true) */
  debug?: boolean;
}

/**
 * Get chain ID from network name.
 * Uses the chain object from config if available.
 */
export function getNetworkId(network: string, config?: FacilitatorConfig): number {
  const chainConfig = config?.evmChains?.[network];
  if (chainConfig) {
    return chainConfig.chain.id;
  }
  return 0;
}
