import { fromHex } from "@fastxyz/sdk";
import type { NetworkConfig } from "../schemas/networks.js";
import { TokenNotFoundError, UnsupportedChainError } from "../errors/index.js";

export interface ResolvedToken {
  readonly fastTokenId: Uint8Array;
  readonly decimals: number;
  readonly evmAddress?: string;
}

/**
 * Map a token name to its on-Fast id, decimals, and (when bridging) EVM address.
 *
 * - With chain context (bridge route): only chain-scoped `allSet.chains[chain].tokens` is consulted.
 * - Without chain context (Fast→Fast): `network.fastTokens` is consulted first, then chain-scoped tokens.
 */
export function resolveToken(
  tokenName: string,
  networkConfig: NetworkConfig,
  chain?: string,
): ResolvedToken {
  if (chain) {
    const allset = networkConfig.allSet;
    if (!allset) {
      throw new TokenNotFoundError({ token: tokenName });
    }
    const chainConfig = allset.chains[chain];
    if (!chainConfig) {
      throw new UnsupportedChainError({ chain });
    }
    const token = chainConfig.tokens[tokenName];
    if (!token) {
      throw new TokenNotFoundError({ token: tokenName });
    }
    return {
      fastTokenId: fromHex(token.fastTokenId),
      decimals: token.decimals,
      evmAddress: token.evmAddress,
    };
  }

  const fast = networkConfig.fastTokens?.[tokenName];
  if (fast) {
    return {
      fastTokenId: fromHex(fast.fastTokenId),
      decimals: fast.decimals,
    };
  }

  const allset = networkConfig.allSet;
  if (allset) {
    for (const chainConfig of Object.values(allset.chains)) {
      const token = chainConfig.tokens[tokenName];
      if (token) {
        return {
          fastTokenId: fromHex(token.fastTokenId),
          decimals: token.decimals,
        };
      }
    }
  }

  throw new TokenNotFoundError({ token: tokenName });
}

/**
 * Pure name-selection: pick the implicit default token NAME for a Fast→Fast
 * operation without decoding any token IDs. Never throws.
 *
 * Priority: `fastTokens.fastUSD` → single `fastTokens` entry → first chain's
 * first token → `undefined` (no token registered for this network).
 *
 * Callers that need the decoded `ResolvedToken` should follow up with
 * `resolveToken(name, network)` inside their existing error wrapper, so any
 * decode failure flows through the normal CLI error path.
 */
export function pickDefaultTokenName(
  networkConfig: NetworkConfig,
): string | undefined {
  const fast = networkConfig.fastTokens;
  if (fast) {
    if ("fastUSD" in fast) return "fastUSD";
    const keys = Object.keys(fast);
    if (keys.length === 1) return keys[0];
    // Multiple entries, none called "fastUSD" — ambiguous, fall through.
  }

  const allset = networkConfig.allSet;
  if (allset) {
    const firstChain = Object.values(allset.chains)[0];
    if (firstChain) {
      return Object.keys(firstChain.tokens)[0];
    }
  }

  return undefined;
}

/**
 * Resolve the implicit default token (name + decoded ResolvedToken) for a
 * Fast→Fast operation. Throws TokenNotFoundError if none is registered, or
 * propagates `fromHex` failures on malformed `fastTokenId` values.
 */
export function resolveDefaultToken(networkConfig: NetworkConfig): {
  readonly name: string;
  readonly token: ResolvedToken;
} {
  const name = pickDefaultTokenName(networkConfig);
  if (name === undefined) {
    throw new TokenNotFoundError({ token: "<default>" });
  }
  return { name, token: resolveToken(name, networkConfig) };
}

/** Normalise a hex string for comparison: strip leading 0x and lowercase. */
const norm = (h: string): string =>
  (h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h).toLowerCase();

/**
 * Inverse of resolveToken: given a fastTokenId hex (server's payment requirement),
 * return the registered display name. Searches `fastTokens` then `allSet.chains[*].tokens`.
 * Returns undefined when no entry matches.
 */
export function lookupTokenNameById(
  networkConfig: NetworkConfig,
  fastTokenId: string,
): string | undefined {
  const target = norm(fastTokenId);

  const fast = networkConfig.fastTokens;
  if (fast) {
    for (const [name, entry] of Object.entries(fast)) {
      if (norm(entry.fastTokenId) === target) return name;
    }
  }

  const allset = networkConfig.allSet;
  if (allset) {
    for (const chain of Object.values(allset.chains)) {
      for (const [name, entry] of Object.entries(chain.tokens)) {
        if (norm(entry.fastTokenId) === target) return name;
      }
    }
  }

  return undefined;
}
