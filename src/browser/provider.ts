import { createBrowserConfigSource } from '../config/browser.js';
import { BaseFastProvider } from '../core/provider-base.js';
import type { ProviderOptions } from '../core/types.js';

export class FastProvider extends BaseFastProvider {
  constructor(opts?: ProviderOptions) {
    super(opts, createBrowserConfigSource({
      network: opts?.network,
      networks: opts?.networks,
      tokens: opts?.tokens,
    }));
  }
}
