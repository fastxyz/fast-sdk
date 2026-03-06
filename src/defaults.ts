/**
 * defaults.ts — Default Fast chain configuration
 */

import type { NetworkType, ChainConfig } from './types.js';

export type KnownFastToken = {
  symbol: string;
  tokenId: string;
  decimals: number;
};

/** Default Fast chain configs */
export const FAST_CHAIN_CONFIGS: Record<NetworkType, ChainConfig> = {
  testnet: {
    rpc: 'https://api.fast.xyz/proxy',
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
export const DEFAULT_RPC_URL = 'https://api.fast.xyz/proxy';

const FAST_KNOWN_TOKENS: Record<string, KnownFastToken> = {
  SETUSDC: {
    symbol: 'SETUSDC',
    tokenId: '0x1e744900021182b293538bb6685b77df095e351364d550021614ce90c8ab9e0a',
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
