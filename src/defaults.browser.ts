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
  network?: NetworkType;
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

export async function resolveKnownFastToken(
  token: string,
  network: NetworkType = 'testnet',
): Promise<KnownFastToken | null> {
  return getDefaultBrowserConfigSource().resolveKnownFastToken(token, network);
}

export async function getAllTokens(
  network: NetworkType = 'testnet',
): Promise<Record<string, KnownFastToken>> {
  return getDefaultBrowserConfigSource().getAllTokens(network);
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
