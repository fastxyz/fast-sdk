import { createBrowserConfigSource } from './defaults.browser.js';
import { BaseFastProvider } from './provider-core.js';
import type { ProviderOptions } from './types.js';

export class FastProvider extends BaseFastProvider {
  constructor(opts?: ProviderOptions) {
    super(opts, createBrowserConfigSource({
      network: opts?.network,
      networks: opts?.networks,
      tokens: opts?.tokens,
    }));
  }
}
