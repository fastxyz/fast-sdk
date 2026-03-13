import { createNodeConfigSource } from './defaults.js';
import { BaseFastProvider } from './provider-core.js';
import type { ProviderOptions } from './types.js';

/**
 * FastProvider — Node-oriented read-only connection to the Fast network.
 *
 * Uses bundled defaults, constructor overrides, and `~/.fast/*` config files.
 */
export class FastProvider extends BaseFastProvider {
  constructor(opts?: ProviderOptions) {
    super(opts, createNodeConfigSource({
      network: opts?.network,
      networks: opts?.networks,
      tokens: opts?.tokens,
    }));
  }
}
