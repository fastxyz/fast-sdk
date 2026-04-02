/**
 * Network configuration types for x402.
 *
 * These interfaces describe the configuration that callers must provide.
 * No hardcoded values — the SDK is network-agnostic.
 */

/**
 * EVM chain configuration provided by the caller.
 */
export interface EvmChainConfig {
  /** Numeric chain ID (e.g. 42161 for Arbitrum) */
  chainId: number;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** USDC contract address on this chain */
  usdcAddress: `0x${string}`;
  /** USDC contract name for EIP-712 domain (default: "USD Coin") */
  usdcName?: string;
  /** USDC contract version for EIP-712 domain (default: "2") */
  usdcVersion?: string;
}

/**
 * Fast network configuration provided by the caller.
 */
export interface FastNetworkConfig {
  /** Fast RPC endpoint URL */
  rpcUrl: string;
  /** USDC token ID on the Fast network (hex with 0x prefix) */
  tokenId: string;
  /** Network ID used in signed transactions (e.g. "fast:testnet") */
  networkId: string;
  /** Trusted committee public keys (hex with 0x prefix) */
  committeePublicKeys: string[];
}
