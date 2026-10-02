import { fromHex } from "@fastxyz/sdk";
import type { NetworkConfig } from "../schemas/networks.js";
import { TokenNotFoundError, UnsupportedChainError } from "../errors/index.js";

export interface ResolvedToken {
  readonly fastTokenId: Uint8Array;
  readonly decimals: number;
  readonly evmAddress?: string;
}

/**
 * Look a token symbol up in a `tokens` map: an exact key first, then a
 * case-insensitive match (SPEC §7, e.g. "usdc" → "USDC").
 */
function findTokenKey(tokens: Record<string, unknown>, tokenName: string): string | undefined {
  if (Object.hasOwn(tokens, tokenName)) return tokenName;
  const wanted = tokenName.toLowerCase();
  return Object.keys(tokens).find((key) => key.toLowerCase() === wanted);
}

/**
 * Map a token name to its on-Fast id, decimals, and (when bridging) EVM address.
 *
 * - With chain context (bridge route): only chain-scoped `allSet.chains[chain].tokens` is consulted.
 * - Without chain context (Fast→Fast): `network.defaultToken` is consulted first,
 *   then chain-scoped tokens.
 *
 * Symbols match exactly first; failing that, case-insensitively (SPEC §7), so
 * `usdc` resolves like `USDC` and `fastusd` like `fastUSD`.
 */
export function resolveToken(
  tokenName: string,
  networkConfig: NetworkConfig,
  chain?: string,
): ResolvedToken {
  // Chain context (bridge route): only consult chain-scoped tokens.
  if (chain) {
    const allset = networkConfig.allSet;
    if (!allset) throw new TokenNotFoundError({ token: tokenName });
    const chainConfig = allset.chains[chain];
    if (!chainConfig) throw new UnsupportedChainError({ chain });
    const key = findTokenKey(chainConfig.tokens, tokenName);
    const token = key === undefined ? undefined : chainConfig.tokens[key];
    if (!token) throw new TokenNotFoundError({ token: tokenName });
    return {
      fastTokenId: fromHex(token.fastTokenId),
      decimals: token.decimals,
      evmAddress: token.evmAddress,
    };
  }

  // No chain context (Fast → Fast). Exact matches win over case-insensitive ones.
  const def = networkConfig.defaultToken;
  const chains = Object.values(networkConfig.allSet?.chains ?? {});
  for (const exact of [true, false]) {
    const same = (symbol: string) =>
      exact ? symbol === tokenName : symbol.toLowerCase() === tokenName.toLowerCase();

    // 1) network.defaultToken (fastUSD on mainnet, testUSDC on testnet).
    if (def && same(def.symbol)) {
      return {
        fastTokenId: fromHex(def.tokenId),
        decimals: def.decimals,
      };
    }

    // 2) Chain-scoped tokens (testUSDC, USDC, etc.).
    for (const chainConfig of chains) {
      const key = Object.keys(chainConfig.tokens).find(same);
      const token = key === undefined ? undefined : chainConfig.tokens[key];
      if (token) {
        return { fastTokenId: fromHex(token.fastTokenId), decimals: token.decimals };
      }
    }
  }

  throw new TokenNotFoundError({ token: tokenName });
}

/** Normalise a hex string for comparison: strip leading 0x and lowercase. */
const norm = (h: string): string =>
  (h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h).toLowerCase();

/**
 * Inverse of resolveToken: given a fastTokenId hex (server's payment requirement),
 * return the registered display name. Searches `allSet.chains[*].tokens` first, then
 * falls back to `network.defaultToken`. Returns undefined when no entry matches.
 *
 * Chain-scoped tokens take priority over `defaultToken` so a token that appears in
 * both maps (e.g. a bridge route entry) is labelled by its chain name rather than
 * the network's symbolic default.
 */
export function lookupTokenNameById(
  networkConfig: NetworkConfig,
  fastTokenId: string,
): string | undefined {
  const target = norm(fastTokenId);

  const allset = networkConfig.allSet;
  if (allset) {
    for (const chain of Object.values(allset.chains)) {
      for (const [name, entry] of Object.entries(chain.tokens)) {
        if (norm(entry.fastTokenId) === target) return name;
      }
    }
  }

  const def = networkConfig.defaultToken;
  if (def && norm(def.tokenId) === target) return def.symbol;

  return undefined;
}

/**
 * True when `tokenName` exists somewhere on the network — either as the
 * network's default token or in some chain's tokens map. Used by handlers
 * to decide whether a chain-context TokenNotFoundError should be rewrapped
 * as CommandUnsupportedForTokenError (token-on-wrong-chain) or kept as
 * TokenNotFoundError (typo / unknown token).
 */
export function tokenIsKnownOnNetwork(
  networkConfig: NetworkConfig,
  tokenName: string,
): boolean {
  if (networkConfig.defaultToken?.symbol === tokenName) return true;
  const allset = networkConfig.allSet;
  if (allset) {
    for (const chain of Object.values(allset.chains)) {
      if (chain.tokens[tokenName]) return true;
    }
  }
  return false;
}

/**
 * Label and decimals of a Fast-side token id, from the network's known tokens.
 *
 * Unlike `lookupTokenNameById` (which prefers chain-scoped bridge names), the
 * network's `defaultToken` wins here, matching how `fast info balance` and
 * `fast send` label the Fast-side asset (e.g. `fastUSD` rather than `USDC` on
 * mainnet). Chain-scoped names are the fallback. Returns undefined for tokens
 * the network config does not know.
 */
export function lookupFastTokenById(
  networkConfig: NetworkConfig,
  fastTokenId: string,
): { readonly name: string; readonly decimals: number } | undefined {
  const target = norm(fastTokenId);
  const def = networkConfig.defaultToken;
  if (def && norm(def.tokenId) === target) {
    return { name: def.symbol, decimals: def.decimals };
  }
  const name = lookupTokenNameById(networkConfig, fastTokenId);
  if (name === undefined) return undefined;
  for (const chain of Object.values(networkConfig.allSet?.chains ?? {})) {
    const entry = chain.tokens[name];
    if (entry && norm(entry.fastTokenId) === target) {
      return { name, decimals: entry.decimals };
    }
  }
  return undefined;
}
