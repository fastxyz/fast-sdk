/**
 * config.ts — Fast SDK configuration directory utilities
 *
 * Provides path helpers for the Fast config directory (~/.fast/).
 * Network and token configuration is loaded from JSON files in defaults.ts.
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Returns the expanded path to the config directory (~/.fast/ by default).
 * Override with FAST_CONFIG_DIR env var.
 */
export function getConfigDir(): string {
  const override = process.env.FAST_CONFIG_DIR;
  if (override) {
    return override.startsWith('~')
      ? path.join(os.homedir(), override.slice(1))
      : override;
  }
  return path.join(os.homedir(), '.fast');
}

/**
 * Returns the expanded path to the keys directory (~/.fast/keys/).
 */
export function getKeysDir(): string {
  return path.join(getConfigDir(), 'keys');
}
