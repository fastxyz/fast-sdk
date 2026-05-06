import type { NetworkConfig } from "../schemas/networks.js";
import { lookupTokenNameById } from "../services/token-resolver.js";

/**
 * Translate a server-supplied asset hex into a display string for the pay
 * dry-run printer and the history entry's `tokenName` column.
 *
 * - undefined / "" → "unknown"
 * - registered → the registry's display name (e.g. "fastUSD", "USDC")
 * - unregistered hex → the hex itself (so callers can still trace it on-chain)
 */
export function labelAssetForPayment(
  networkConfig: NetworkConfig,
  asset: string | undefined,
): string {
  if (!asset) return "unknown";
  const name = lookupTokenNameById(networkConfig, asset);
  return name ?? asset;
}
