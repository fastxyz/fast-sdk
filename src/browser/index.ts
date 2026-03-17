/**
 * @fastxyz/sdk/browser — Browser-safe Fast SDK entrypoint
 *
 * No file I/O, no Node dependencies. Safe for browser bundlers.
 */

// Re-export everything from core
export * from '../core/index.js';

// Browser-specific provider (static config only)
export { FastProvider } from './provider.js';

// Config accessors (no file loading)
export {
  getNetworkInfo,
  getAllNetworks,
  resolveKnownFastToken,
  getAllTokens,
  getDefaultRpcUrl,
  getExplorerUrl,
  clearDefaultsCache,
  createBrowserConfigSource,
} from '../config/browser.js';
