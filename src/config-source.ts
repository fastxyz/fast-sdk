import type { KnownFastToken, NetworkInfo, NetworkType } from './types.js';

import bundledNetworks from './data/networks.json' with { type: 'json' };
import bundledTokens from './data/tokens.json' with { type: 'json' };

export interface ConfigSource {
  getNetworkInfo(network: string): Promise<NetworkInfo | null>;
  getAllNetworks(): Promise<Record<string, NetworkInfo>>;
  resolveKnownFastToken(token: string): Promise<KnownFastToken | null>;
  getAllTokens(): Promise<Record<string, KnownFastToken>>;
  getDefaultRpcUrl(network?: NetworkType): Promise<string>;
  getExplorerUrl(network?: NetworkType): Promise<string | null>;
}

export const FALLBACK_NETWORKS: Record<NetworkType, NetworkInfo> = {
  testnet: {
    rpc: 'https://staging.proxy.fastset.xyz',
    explorer: 'https://explorer.fast.xyz',
  },
  mainnet: {
    rpc: 'https://api.fast.xyz/proxy',
    explorer: 'https://explorer.fast.xyz',
  },
};

export const FALLBACK_TOKENS: Record<string, KnownFastToken> = {
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
};

export function normalizeNetworkMap(
  input?: Record<string, NetworkInfo> | null,
): Record<string, NetworkInfo> {
  return { ...(input ?? {}) };
}

export function normalizeTokenMap(
  input?: Record<string, KnownFastToken> | null,
): Record<string, KnownFastToken> {
  const normalized: Record<string, KnownFastToken> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    normalized[key.toUpperCase()] = value;
  }
  return normalized;
}

export const BUNDLED_NETWORKS = normalizeNetworkMap(bundledNetworks as Record<string, NetworkInfo>);
export const BUNDLED_TOKENS = normalizeTokenMap(bundledTokens as Record<string, KnownFastToken>);

export function mergeNetworkMaps(
  ...sources: Array<Record<string, NetworkInfo> | null | undefined>
): Record<string, NetworkInfo> {
  return Object.assign({}, ...sources.filter(Boolean));
}

export function mergeTokenMaps(
  ...sources: Array<Record<string, KnownFastToken> | null | undefined>
): Record<string, KnownFastToken> {
  const merged: Record<string, KnownFastToken> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      merged[key.toUpperCase()] = value;
    }
  }
  return merged;
}

export function createStaticConfigSource(opts?: {
  networks?: Record<string, NetworkInfo>;
  tokens?: Record<string, KnownFastToken>;
}): ConfigSource {
  const networks = mergeNetworkMaps(
    FALLBACK_NETWORKS as Record<string, NetworkInfo>,
    BUNDLED_NETWORKS,
    normalizeNetworkMap(opts?.networks),
  );
  const tokens = mergeTokenMaps(
    FALLBACK_TOKENS,
    BUNDLED_TOKENS,
    normalizeTokenMap(opts?.tokens),
  );

  return {
    async getNetworkInfo(network: string): Promise<NetworkInfo | null> {
      return networks[network] ?? null;
    },
    async getAllNetworks(): Promise<Record<string, NetworkInfo>> {
      return { ...networks };
    },
    async resolveKnownFastToken(token: string): Promise<KnownFastToken | null> {
      return tokens[token.toUpperCase()] ?? null;
    },
    async getAllTokens(): Promise<Record<string, KnownFastToken>> {
      return { ...tokens };
    },
    async getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
      return networks[network]?.rpc ?? FALLBACK_NETWORKS.testnet.rpc;
    },
    async getExplorerUrl(network: NetworkType = 'testnet'): Promise<string | null> {
      return networks[network]?.explorer ?? null;
    },
  };
}
