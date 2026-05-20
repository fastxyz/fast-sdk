import type { NetworkConfig } from "../schemas/networks.js";
import { pickDefaultTokenName } from "../services/token-resolver.js";

/**
 * Pick the token NAME (a string the resolver later maps to a ResolvedToken) for
 * a `send` invocation given the user's --token flag and bridge chain context.
 * Pure name-selection: never decodes token IDs, never throws. Any decode/lookup
 * failure surfaces from the caller's `resolveToken(...)` step instead.
 *
 * - Explicit --token wins.
 * - With chain context (--from-chain / --to-chain): default to first token on
 *   that chain, falling back to "USDC" if the chain config is somehow empty.
 * - Without chain context (Fast→Fast): pick `fastTokens.fastUSD` if present,
 *   otherwise the network's first registered token, falling back to "USDC".
 */
export function selectSendTokenName(
  explicit: string | undefined,
  networkConfig: NetworkConfig,
  chain: string | undefined,
): string {
  if (explicit !== undefined) return explicit;

  if (chain) {
    const chainCfg = networkConfig.allSet?.chains[chain];
    const first = chainCfg ? Object.keys(chainCfg.tokens)[0] : undefined;
    return first ?? "USDC";
  }

  return pickDefaultTokenName(networkConfig) ?? "USDC";
}
