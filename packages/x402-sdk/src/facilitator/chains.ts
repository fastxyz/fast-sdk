/**
 * Chain configurations for x402-facilitator
 *
 * USDC addresses and EIP-3009 metadata for supported networks.
 * Previously loaded from AllSetProvider, now hardcoded.
 */

import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  sepolia,
} from "viem/chains";
import type { Chain } from "viem";
import type { EvmChainConfig } from "./types.js";

/**
 * EVM chain configurations with USDC addresses
 */
export const EVM_CHAINS: Record<string, EvmChainConfig> = {
  "arbitrum-sepolia": {
    chain: arbitrumSepolia,
    rpcUrl: process.env.ARB_SEPOLIA_RPC_URL,
    usdcAddress: (process.env.ARB_SEPOLIA_USDC_ADDRESS || "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d") as `0x${string}`,
    usdcName: "USD Coin",
    usdcVersion: "2",
  },
  "arbitrum": {
    chain: arbitrum,
    rpcUrl: process.env.ARB_RPC_URL,
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    usdcName: "USD Coin",
    usdcVersion: "2",
  },
  "base-sepolia": {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    usdcName: "USDC",
    usdcVersion: "2",
  },
  "base": {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcName: "USD Coin",
    usdcVersion: "2",
  },
  "ethereum": {
    chain: mainnet,
    rpcUrl: process.env.ETH_RPC_URL,
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdcName: "USD Coin",
    usdcVersion: "2",
  },
  "ethereum-sepolia": {
    chain: sepolia,
    rpcUrl: process.env.ETH_SEPOLIA_RPC,
    usdcAddress: (process.env.ETH_SEPOLIA_USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as `0x${string}`,
    usdcName: "USDC",
    usdcVersion: "2",
  },
};

/**
 * Fast RPC endpoints
 */
export const FAST_RPC_URLS: Record<string, string> = {
  "fast-testnet": "https://testnet.api.fast.xyz/proxy",
  "fast-mainnet": "https://api.fast.xyz/proxy",
};

/**
 * Convert an x402 Fast network name to the CAIP-2 network id used inside
 * signed Fast transactions.
 */
export function getExpectedFastNetworkId(network: string): string | null {
  switch (network) {
    case "fast-testnet":
      return "fast:testnet";
    case "fast-mainnet":
      return "fast:mainnet";
    default:
      return null;
  }
}

/**
 * Bundled trusted Fast validator committees for the official networks.
 */
export const FAST_TRUSTED_COMMITTEE_PUBLIC_KEYS: Record<string, string[]> = {
  "fast-testnet": [
    "0xdfa5a82548d58dbfd17c9eb32818c47a5ca2b8f8e7da84942ca7ca0c7e57f98d",
    "0x62f9728b168c443204c5fee22ff21aef3e4d3c422bc01067f14a6e2a1eab4ae0",
    "0x96145c0ca385ced0bfbd2ab28578e0acb774912ff3e8dd166ef326b1178b0a78",
    "0xecf967fc920082df854828574315bb0d6434c1c2f29843b50802964833e6f5a9",
  ],
  "fast-mainnet": [
    "0x2a0f5870993fac2f20999e23e763838a40595c6f3d971f327e264bc5442e598c",
    "0x03473bc3523e0c2b0e259b179251774764782473854317f519e0e16e9d77f680",
    "0xb4d47f3f43906f354410da1ca02c8436a3550855d105b0d29c135b6a27361387",
    "0x08210bb6ae6b46eef95d7815d12d1820c368f5a6e8c76cc4dd3812b67cd54324",
  ],
};

/**
 * Get chain config for a network
 */
export function getEvmChainConfig(network: string): EvmChainConfig | null {
  return EVM_CHAINS[network] || null;
}

/**
 * Get Fast RPC URL
 */
export function getFastRpcUrl(network: string, override?: string): string {
  return override || FAST_RPC_URLS[network] || FAST_RPC_URLS["fast-testnet"];
}

/**
 * List of supported EVM networks
 */
export const SUPPORTED_EVM_NETWORKS = Object.keys(EVM_CHAINS);

/**
 * List of supported Fast networks
 */
export const SUPPORTED_FAST_NETWORKS = Object.keys(FAST_RPC_URLS);
