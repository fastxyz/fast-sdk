import type { DefaultAsset } from '@x402/core/types';

export const FAST_SUPPORTED_NETWORKS = Object.freeze(['fast:mainnet', 'fast:testnet'] as const);
export type FastNetwork = (typeof FAST_SUPPORTED_NETWORKS)[number];

export const FAST_DEFAULT_ASSETS: Readonly<Record<FastNetwork, Readonly<DefaultAsset>>> = Object.freeze({
  'fast:mainnet': Object.freeze({
    asset: '0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130',
    symbol: 'fastUSD', decimals: 6,
  }),
  'fast:testnet': Object.freeze({
    asset: '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46',
    symbol: 'testUSDC', decimals: 6,
  }),
});

export function assertFastNetwork(network: string): asserts network is FastNetwork {
  if (network !== 'fast:mainnet' && network !== 'fast:testnet') {
    throw new Error(`Unsupported Fast network: ${network}`);
  }
}
