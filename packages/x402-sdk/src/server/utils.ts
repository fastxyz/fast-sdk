/**
 * x402-server utilities
 *
 * Token configs are hardcoded for supported networks.
 * EIP-3009 metadata stays local as it's x402-specific.
 */

import type { NetworkConfig } from "./types.js";

const FAST_MAINNET_USDC_TOKEN_ID =
  "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130";

const FAST_TESTNET_USDC_TOKEN_ID =
  "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46";

/**
 * Default network configurations
 * USDC addresses and EIP-3009 metadata for supported networks.
 */
export const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
  // Fast networks
  "fast-testnet": {
    asset: FAST_TESTNET_USDC_TOKEN_ID,
    decimals: 6,
  },
  "fast-mainnet": {
    asset: FAST_MAINNET_USDC_TOKEN_ID,
    decimals: 6,
  },
  // EVM testnets
  "ethereum-sepolia": {
    asset: process.env.ETH_SEPOLIA_USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    extra: { name: "USDC", version: "2" },
  },
  "arbitrum-sepolia": {
    asset: process.env.ARB_SEPOLIA_USDC_ADDRESS || "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
  },
  "base-sepolia": {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    extra: { name: "USDC", version: "2" },
  },
  // EVM mainnets
  "ethereum": {
    asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
  },
  "arbitrum": {
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
  },
  "base": {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    extra: { name: "USD Coin", version: "2" },
  },
};

/**
 * Reject deprecated network aliases that no longer map to a valid payment flow.
 */
export function assertSupportedPaymentNetwork(network: string): void {
  if (network === "fast") {
    throw new Error(
      'Unsupported Fast network alias "fast". Use "fast-testnet" or "fast-mainnet".'
    );
  }

  if (!(network in NETWORK_CONFIGS)) {
    throw new Error(`Unsupported payment network: ${network}`);
  }
}

/**
 * Parse price string to amount in base units
 * Supports formats: "$0.10", "0.1 USDC", "100000" (raw)
 */
export function parsePrice(price: string, decimals: number = 6): string {
  const cleaned = price.replace(/[$,\s]/g, "").replace(/usdc/i, "").trim();

  // Check if it's already a raw integer
  if (/^\d+$/.test(cleaned)) {
    return cleaned;
  }

  // Parse as decimal
  const value = parseFloat(cleaned);
  if (isNaN(value)) {
    throw new Error(`Invalid price format: ${price}`);
  }

  const amount = Math.round(value * Math.pow(10, decimals));
  return amount.toString();
}

/**
 * Get network config, with fallback to generic USDC
 */
export function getNetworkConfig(network: string): NetworkConfig {
  assertSupportedPaymentNetwork(network);
  return NETWORK_CONFIGS[network]!;
}

/**
 * Encode payload to base64
 */
export function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Decode base64 payload
 */
export function decodePayload<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, "base64").toString());
}
