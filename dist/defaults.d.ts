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
export declare const FAST_CHAIN_CONFIGS: Record<NetworkType, ChainConfig>;
/** Default RPC URL */
export declare const DEFAULT_RPC_URL = "https://api.fast.xyz/proxy";
/**
 * Derive the config storage key from network.
 * Testnet uses bare 'fast', mainnet uses 'fast:mainnet'.
 */
export declare function configKey(network: NetworkType): string;
/**
 * Parse a config key back to network.
 */
export declare function parseConfigKey(key: string): NetworkType;
export declare function resolveKnownFastToken(token: string): KnownFastToken | null;
//# sourceMappingURL=defaults.d.ts.map