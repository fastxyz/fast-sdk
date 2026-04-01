/**
 * Fast RPC endpoint resolution for x402-client.
 */

export const FAST_RPC_URLS: Record<string, string> = {
  "fast-testnet": "https://testnet.api.fast.xyz/proxy",
  "fast-mainnet": "https://api.fast.xyz/proxy",
};

export function resolveFastRpcUrl(network: string, override?: string): string {
  return override || FAST_RPC_URLS[network] || FAST_RPC_URLS["fast-testnet"];
}
