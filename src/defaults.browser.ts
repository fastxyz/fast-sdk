import { createStaticConfigSource, type ConfigSource } from './config-source.js';
import type { KnownFastToken, NetworkInfo, NetworkType } from './types.js';

let _browserConfigSource: ConfigSource | null = null;

function getDefaultBrowserConfigSource(): ConfigSource {
  if (!_browserConfigSource) {
    _browserConfigSource = createStaticConfigSource();
  }
  return _browserConfigSource;
}

export function createBrowserConfigSource(opts?: {
  networks?: Record<string, NetworkInfo>;
  tokens?: Record<string, KnownFastToken>;
}): ConfigSource {
  return createStaticConfigSource(opts);
}

export async function getNetworkInfo(network: string): Promise<NetworkInfo | null> {
  return getDefaultBrowserConfigSource().getNetworkInfo(network);
}

export async function getAllNetworks(): Promise<Record<string, NetworkInfo>> {
  return getDefaultBrowserConfigSource().getAllNetworks();
}

export async function resolveKnownFastToken(token: string): Promise<KnownFastToken | null> {
  return getDefaultBrowserConfigSource().resolveKnownFastToken(token);
}

export async function getAllTokens(): Promise<Record<string, KnownFastToken>> {
  return getDefaultBrowserConfigSource().getAllTokens();
}

export async function getDefaultRpcUrl(network: NetworkType = 'testnet'): Promise<string> {
  return getDefaultBrowserConfigSource().getDefaultRpcUrl(network);
}

export async function getExplorerUrl(network: NetworkType = 'testnet'): Promise<string | null> {
  return getDefaultBrowserConfigSource().getExplorerUrl(network);
}

export function clearDefaultsCache(): void {
  _browserConfigSource = null;
}
