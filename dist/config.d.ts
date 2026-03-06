import type { FastConfig, ChainConfig } from './types.js';
/**
 * Returns the expanded path to the config directory (~/.fast/ by default).
 * Override with FAST_CONFIG_DIR env var.
 */
export declare function getConfigDir(): string;
/**
 * Returns the expanded path to the keys directory (~/.fast/keys/).
 */
export declare function getKeysDir(): string;
/**
 * Load the config from ~/.fast/config.json.
 * Returns { chains: {} } if the file does not exist.
 */
export declare function loadConfig(): Promise<FastConfig>;
/**
 * Save the config to ~/.fast/config.json.
 * Creates ~/.fast/ with mode 0700 if needed.
 * Writes the file with mode 0600.
 */
export declare function saveConfig(config: FastConfig): Promise<void>;
/**
 * Get the config for a specific chain, or null if not configured.
 */
export declare function getChainConfig(chain: string): Promise<ChainConfig | null>;
/**
 * Add or update a chain's config and persist it.
 */
export declare function setChainConfig(chain: string, chainConfig: ChainConfig): Promise<void>;
//# sourceMappingURL=config.d.ts.map