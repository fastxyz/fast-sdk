import type { NetworkConfig } from "../schemas/networks.js";
import { resolveDefaultToken } from "../services/token-resolver.js";

/**
 * Pick the token NAME (a string the resolver later maps to a ResolvedToken) for
 * a `send` invocation given the user's --token flag and bridge chain context.
 *
 * - Explicit --token wins.
 * - With chain context (--from-chain / --to-chain): default to first token on that
 *   chain, falling back to "USDC" only if the chain config is somehow empty.
 * - Without chain context (Fast→Fast): use resolveDefaultToken (prefers fastTokens.fastUSD on mainnet).
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

  return resolveDefaultToken(networkConfig).name;
}
