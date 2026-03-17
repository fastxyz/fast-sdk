/**
 * @fastxyz/sdk (Node entrypoint)
 *
 * Full SDK with file-based configuration and keyfile support.
 * For browser usage, import from '@fastxyz/sdk/browser'.
 */

// Re-export everything from core
export * from '../core/index.js';

// Node-specific provider (with ~/.fast/ config loading)
export { FastProvider } from './provider.js';

// Node-specific wallet (with keyfile support)
export { FastWallet } from './wallet.js';

// Config accessors (with file loading)
export {
  getNetworkInfo,
  getAllNetworks,
  resolveKnownFastToken,
  getAllTokens,
  getDefaultRpcUrl,
  getExplorerUrl,
  clearDefaultsCache,
  createNodeConfigSource,
} from '../config/file-loader.js';

// Path helpers
export { getConfigDir, getKeysDir } from '../config/paths.js';

// Key utilities (for advanced use)
export {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  signEd25519,
  verifyEd25519,
} from './keys.js';

// Utility helpers
export { expandHome } from './utils.js';
