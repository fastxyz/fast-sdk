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
import {
  createStaticConfigSource,
  mergeNetworkMaps,
  mergeTokenMaps,
  normalizeNetworkMap,
  normalizeTokenMap,
  type ConfigSource,
} from './config-source.js';
import type { KnownFastToken, NetworkInfo, NetworkType } from './types.js';
import { getConfigDir } from './config.js';
export type { KnownFastToken, NetworkInfo };

let _nodeConfigSource: ConfigSource | null = null;

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

export function createNodeConfigSource(opts?: {
  networks?: Record<string, NetworkInfo>;
  tokens?: Record<string, KnownFastToken>;
}): ConfigSource {
  let networksCache: Record<string, NetworkInfo> | null = null;
  let tokensCache: Record<string, KnownFastToken> | null = null;

  async function loadNetworks(): Promise<Record<string, NetworkInfo>> {
    if (networksCache) return networksCache;
    const userPath = path.join(getConfigDir(), 'networks.json');
    const user = await loadJsonFile<Record<string, NetworkInfo>>(userPath);
    networksCache = mergeNetworkMaps(
      await createStaticConfigSource().getAllNetworks(),
      normalizeNetworkMap(user),
      normalizeNetworkMap(opts?.networks),
    );
    return networksCache;
  }

  async function loadTokens(): Promise<Record<string, KnownFastToken>> {
    if (tokensCache) return tokensCache;
    const userPath = path.join(getConfigDir(), 'tokens.json');
    const user = await loadJsonFile<Record<string, KnownFastToken>>(userPath);
    tokensCache = mergeTokenMaps(
      await createStaticConfigSource().getAllTokens(),
      normalizeTokenMap(user),
      normalizeTokenMap(opts?.tokens),
    );
    return tokensCache;
  }

  return {
    async getNetworkInfo(network: string): Promise<NetworkInfo | null> {
      const networks = await loadNetworks();
      return networks[network] ?? null;
    },
    async getAllNetworks(): Promise<Record<string, NetworkInfo>> {
      return loadNetworks();
    },
    async resolveKnownFastToken(token: string): Promise<KnownFastToken | null> {
      const tokens = await loadTokens();
      return tokens[token.toUpperCase()] ?? null;
    },
    async getAllTokens(): Promise<Record<string, KnownFastToken>> {
      return loadTokens();
    },
    async getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
      const networks = await loadNetworks();
      return networks[network]?.rpc ?? (await createStaticConfigSource().getDefaultRpcUrl(network));
    },
    async getExplorerUrl(network: NetworkType = 'testnet'): Promise<string | null> {
      const networks = await loadNetworks();
      return networks[network]?.explorer ?? null;
    },
  };
}

function getDefaultNodeConfigSource(): ConfigSource {
  if (!_nodeConfigSource) {
    _nodeConfigSource = createNodeConfigSource();
  }
  return _nodeConfigSource;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Public API
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Get network info by name (testnet, mainnet, or custom).
 * Returns null if network is not found.
 */
export async function getNetworkInfo(network: string): Promise<NetworkInfo | null> {
  return getDefaultNodeConfigSource().getNetworkInfo(network);
}

/**
 * Get all known networks.
 */
export async function getAllNetworks(): Promise<Record<string, NetworkInfo>> {
  return getDefaultNodeConfigSource().getAllNetworks();
}

/**
 * Resolve a known token by symbol (case-insensitive).
 * Returns null if token is not found.
 */
export async function resolveKnownFastToken(token: string): Promise<KnownFastToken | null> {
  return getDefaultNodeConfigSource().resolveKnownFastToken(token);
}

/**
 * Get all known tokens.
 */
export async function getAllTokens(): Promise<Record<string, KnownFastToken>> {
  return getDefaultNodeConfigSource().getAllTokens();
}

/**
 * Get the default RPC URL for a network.
 */
export async function getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
  return getDefaultNodeConfigSource().getDefaultRpcUrl(network);
}

/**
 * Get the explorer URL for a network.
 * Returns null if no explorer is configured.
 */
export async function getExplorerUrl(network: NetworkType = 'testnet'): Promise<string | null> {
  return getDefaultNodeConfigSource().getExplorerUrl(network);
}

/**
 * Clear the cache (useful for testing).
 */
export function clearDefaultsCache(): void {
  _nodeConfigSource = null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Legacy Exports (for backwards compatibility during transition)
 * ───────────────────────────────────────────────────────────────────────────── */

/** @deprecated Use getDefaultRpcUrl() instead */
export const DEFAULT_RPC_URL = 'https://staging.proxy.fastset.xyz';
