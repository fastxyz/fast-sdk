/**
 * defaults.ts — Default Fast configuration
 *
 * Priority order (highest to lowest):
 * 1. User overrides: ~/.fast/networks.json, ~/.fast/tokens.json
 * 2. Bundled JSON (imported as modules)
 * 3. Hardcoded fallbacks (this file)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { NetworkType } from './types.js';
import { getConfigDir } from './config.js';

// Import bundled JSON directly (resolveJsonModule: true in tsconfig)
import bundledNetworks from './data/networks.json' with { type: 'json' };
import bundledTokens from './data/tokens.json' with { type: 'json' };

/* ─────────────────────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────────────────────── */

export type NetworkInfo = {
  rpc: string;
  explorer?: string;
};

export type KnownFastToken = {
  symbol: string;
  tokenId: string;
  decimals: number;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Hardcoded Fallbacks (used if JSON files fail to load)
 * ───────────────────────────────────────────────────────────────────────────── */

const FALLBACK_NETWORKS: Record<NetworkType, NetworkInfo> = {
  testnet: {
    rpc: 'https://testnet.api.fast.xyz/proxy',
    explorer: 'https://explorer.fast.xyz',
  },
  mainnet: {
    rpc: 'https://api.fast.xyz/proxy',
    explorer: 'https://explorer.fast.xyz',
  },
};

const FALLBACK_TOKENS: Record<NetworkType, Record<string, KnownFastToken>> = {
  testnet: {
    FAST: {
      symbol: 'FAST',
      tokenId: 'native',
      decimals: 9,
    },
    TESTUSDC: {
      symbol: 'testUSDC',
      tokenId: '0x9c52fe9465f57bc526c11aa0c048fd8709aa46abc06d15c80cbed9263d4d4df8',
      decimals: 6,
    },
  },
  mainnet: {
    FAST: {
      symbol: 'FAST',
      tokenId: 'native',
      decimals: 9,
    },
    FASTUSDC: {
      symbol: 'fastUSDC',
      tokenId: '0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5',
      decimals: 6,
    },
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Cache (lazy-loaded on first access)
 * ───────────────────────────────────────────────────────────────────────────── */

let _networksCache: Record<string, NetworkInfo> | null = null;
let _tokensCache: Record<NetworkType, Record<string, KnownFastToken>> | null = null;

/* ─────────────────────────────────────────────────────────────────────────────
 * JSON Loading Helpers
 * ───────────────────────────────────────────────────────────────────────────── */

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadNetworks(): Promise<Record<string, NetworkInfo>> {
  if (_networksCache) return _networksCache;

  // Start with hardcoded fallbacks
  const merged: Record<string, NetworkInfo> = { ...FALLBACK_NETWORKS };

  // Layer 2: Bundled JSON (imported as module)
  Object.assign(merged, bundledNetworks as Record<string, NetworkInfo>);

  // Layer 3: User overrides (~/.fast/networks.json)
  const userPath = path.join(getConfigDir(), 'networks.json');
  const user = await loadJsonFile<Record<string, NetworkInfo>>(userPath);
  if (user) {
    Object.assign(merged, user);
  }

  _networksCache = merged;
  return merged;
}

async function loadTokens(): Promise<Record<NetworkType, Record<string, KnownFastToken>>> {
  if (_tokensCache) return _tokensCache;

  // Start with hardcoded fallbacks (deep copy)
  const merged: Record<NetworkType, Record<string, KnownFastToken>> = {
    testnet: { ...FALLBACK_TOKENS.testnet },
    mainnet: { ...FALLBACK_TOKENS.mainnet },
  };

  // Layer 2: Bundled JSON (imported as module)
  const bundled = bundledTokens as Record<string, Record<string, KnownFastToken>>;
  for (const network of ['testnet', 'mainnet'] as NetworkType[]) {
    if (bundled[network]) {
      for (const [key, value] of Object.entries(bundled[network])) {
        merged[network][key.toUpperCase()] = value;
      }
    }
  }

  // Layer 3: User overrides (~/.fast/tokens.json)
  const userPath = path.join(getConfigDir(), 'tokens.json');
  const user = await loadJsonFile<Record<string, Record<string, KnownFastToken>>>(userPath);
  if (user) {
    for (const network of ['testnet', 'mainnet'] as NetworkType[]) {
      if (user[network]) {
        for (const [key, value] of Object.entries(user[network])) {
          merged[network][key.toUpperCase()] = value;
        }
      }
    }
  }

  _tokensCache = merged;
  return merged;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Public API
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Get network info by name (testnet, mainnet, or custom).
 * Returns null if network is not found.
 */
export async function getNetworkInfo(network: string): Promise<NetworkInfo | null> {
  const networks = await loadNetworks();
  return networks[network] ?? null;
}

/**
 * Get all known networks.
 */
export async function getAllNetworks(): Promise<Record<string, NetworkInfo>> {
  return loadNetworks();
}

/**
 * Resolve a known token by symbol (case-insensitive).
 * Returns null if token is not found.
 */
export async function resolveKnownFastToken(
  token: string,
  network: NetworkType = 'testnet'
): Promise<KnownFastToken | null> {
  const tokens = await loadTokens();
  return tokens[network]?.[token.toUpperCase()] ?? null;
}

/**
 * Get all known tokens for a network.
 */
export async function getAllTokens(
  network: NetworkType = 'testnet'
): Promise<Record<string, KnownFastToken>> {
  const tokens = await loadTokens();
  return tokens[network] ?? {};
}

/**
 * Get the default RPC URL for a network.
 */
export async function getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
  const info = await getNetworkInfo(network);
  return info?.rpc ?? FALLBACK_NETWORKS.testnet.rpc;
}

/**
 * Get the explorer URL for a network.
 * Returns null if no explorer is configured.
 */
export async function getExplorerUrl(network: NetworkType = 'testnet'): Promise<string | null> {
  const info = await getNetworkInfo(network);
  return info?.explorer ?? null;
}

/**
 * Clear the cache (useful for testing).
 */
export function clearDefaultsCache(): void {
  _networksCache = null;
  _tokensCache = null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Legacy Exports (for backwards compatibility during transition)
 * ───────────────────────────────────────────────────────────────────────────── */

/** @deprecated Use getDefaultRpcUrl() instead */
export const DEFAULT_RPC_URL = FALLBACK_NETWORKS.testnet.rpc;
