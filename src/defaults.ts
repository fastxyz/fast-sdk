/**
 * defaults.ts — Default Fast configuration
 *
 * Priority order (highest to lowest):
 * 1. Constructor overrides
 * 2. User overrides: ~/.fast/networks.json, ~/.fast/tokens.json
 * 3. Bundled JSON and hardcoded fallbacks
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createStaticConfigSource, mergeNetworkMaps, normalizeNetworkMap, normalizeTokenMap, type ConfigSource } from './config-source.js';
import type { KnownFastToken, NetworkInfo, NetworkType } from './types.js';
import { getConfigDir } from './config.js';

export type { KnownFastToken, NetworkInfo };

let _nodeConfigSource: ConfigSource | null = null;

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createNodeConfigSource(opts?: {
  network?: NetworkType;
  networks?: Record<string, NetworkInfo>;
  tokens?: Record<string, KnownFastToken>;
}): ConfigSource {
  const staticSource = createStaticConfigSource();
  const overrideNetwork = opts?.network ?? 'testnet';
  let networksCache: Record<string, NetworkInfo> | null = null;
  let userTokenCache: Record<string, Record<string, KnownFastToken>> | null = null;
  const tokenCache = new Map<string, Record<string, KnownFastToken>>();

  async function loadNetworks(): Promise<Record<string, NetworkInfo>> {
    if (networksCache) return networksCache;

    const userPath = path.join(getConfigDir(), 'networks.json');
    const user = await loadJsonFile<Record<string, NetworkInfo>>(userPath);
    networksCache = mergeNetworkMaps(
      await staticSource.getAllNetworks(),
      normalizeNetworkMap(user),
      normalizeNetworkMap(opts?.networks),
    );
    return networksCache;
  }

  async function loadUserTokens(): Promise<Record<string, Record<string, KnownFastToken>>> {
    if (userTokenCache) return userTokenCache;

    const userPath = path.join(getConfigDir(), 'tokens.json');
    userTokenCache =
      (await loadJsonFile<Record<string, Record<string, KnownFastToken>>>(userPath)) ?? {};
    return userTokenCache;
  }

  async function loadTokens(network: string): Promise<Record<string, KnownFastToken>> {
    const cached = tokenCache.get(network);
    if (cached) return cached;

    const userTokens = await loadUserTokens();
    const tokens = {
      ...(await staticSource.getAllTokens(network)),
      ...normalizeTokenMap(userTokens[network]),
      ...(network === overrideNetwork ? normalizeTokenMap(opts?.tokens) : {}),
    };

    tokenCache.set(network, tokens);
    return tokens;
  }

  return {
    async getNetworkInfo(network: string): Promise<NetworkInfo | null> {
      const networks = await loadNetworks();
      return networks[network] ?? null;
    },
    async getAllNetworks(): Promise<Record<string, NetworkInfo>> {
      return loadNetworks();
    },
    async resolveKnownFastToken(
      token: string,
      network: NetworkType = 'testnet',
    ): Promise<KnownFastToken | null> {
      const tokens = await loadTokens(network);
      return tokens[token.toUpperCase()] ?? null;
    },
    async getAllTokens(network: NetworkType = 'testnet'): Promise<Record<string, KnownFastToken>> {
      return { ...(await loadTokens(network)) };
    },
    async getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
      const networks = await loadNetworks();
      return networks[network]?.rpc ?? (await staticSource.getDefaultRpcUrl(network));
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

export async function getNetworkInfo(network: string): Promise<NetworkInfo | null> {
  return getDefaultNodeConfigSource().getNetworkInfo(network);
}

export async function getAllNetworks(): Promise<Record<string, NetworkInfo>> {
  return getDefaultNodeConfigSource().getAllNetworks();
}

export async function resolveKnownFastToken(
  token: string,
  network: NetworkType = 'testnet',
): Promise<KnownFastToken | null> {
  return getDefaultNodeConfigSource().resolveKnownFastToken(token, network);
}

export async function getAllTokens(
  network: NetworkType = 'testnet',
): Promise<Record<string, KnownFastToken>> {
  return getDefaultNodeConfigSource().getAllTokens(network);
}

export async function getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
  return getDefaultNodeConfigSource().getDefaultRpcUrl(network);
}

export async function getExplorerUrl(network: NetworkType = 'testnet'): Promise<string | null> {
  return getDefaultNodeConfigSource().getExplorerUrl(network);
}

export function clearDefaultsCache(): void {
  _nodeConfigSource = null;
}

/** @deprecated Use getDefaultRpcUrl() instead */
export const DEFAULT_RPC_URL = 'https://testnet.api.fast.xyz/proxy';
