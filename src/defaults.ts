/**
 * defaults.ts — Default Fast configuration
 */

import type { NetworkType, NetworkConfig } from './types.js';

export type KnownFastToken = {
  symbol: string;
  tokenId: string;
  decimals: number;
};

/** Default Fast configs */
export const FAST_NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  testnet: {
    rpc: 'https://staging.proxy.fastset.xyz',
    keyfile: '~/.fast/keys/fast.json',
    network: 'testnet',
    defaultToken: 'SET',
  },
  mainnet: {
    rpc: 'https://api.fast.xyz/proxy',
    keyfile: '~/.fast/keys/fast.json',
    network: 'mainnet',
    defaultToken: 'SET',
  },
};

/** Default RPC URL */
export const DEFAULT_RPC_URL = 'https://staging.proxy.fastset.xyz';

const FAST_KNOWN_TOKENS: Record<string, KnownFastToken> = {
  FASTUSDC: {
    symbol: 'fastUSDC',
    tokenId: '0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5',
    decimals: 6,
  },
};

/**
 * Derive the config storage key from network.
 * Testnet uses bare 'fast', mainnet uses 'fast:mainnet'.
 */
export function configKey(network: NetworkType): string {
  return network === 'mainnet' ? 'fast:mainnet' : 'fast';
}

/**
 * Parse a config key back to network.
 */
export function parseConfigKey(key: string): NetworkType {
  if (key.endsWith(':mainnet')) return 'mainnet';
  return 'testnet';
}

export function resolveKnownFastToken(token: string): KnownFastToken | null {
  return FAST_KNOWN_TOKENS[token.toUpperCase()] ?? null;
}
