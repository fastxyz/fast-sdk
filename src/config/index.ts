/**
 * config/ — Configuration system
 *
 * - source.ts: ConfigSource interface and static implementation (browser-safe)
 * - browser.ts: Browser config accessors (no file I/O)
 * - file-loader.ts: File-based config loading (Node-only)
 * - paths.ts: Path helpers like getConfigDir (Node-only)
 */

// Re-export browser-safe config source
export {
  type ConfigSource,
  FALLBACK_NETWORKS,
  FALLBACK_TOKENS,
  BUNDLED_NETWORKS,
  BUNDLED_TOKENS,
  createStaticConfigSource,
  normalizeNetworkMap,
  normalizeTokenMap,
  mergeNetworkMaps,
  mergeTokenMaps,
} from './source.js';
