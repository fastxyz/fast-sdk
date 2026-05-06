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
 * Resolve the implicit default token for a Fast→Fast operation.
 * Prefers `fastTokens.fastUSD`, then any single `fastTokens` entry,
 * then the first chain's first token. Throws TokenNotFoundError if none.
 */
export function resolveDefaultToken(networkConfig: NetworkConfig): {
  readonly name: string;
  readonly token: ResolvedToken;
} {
  const fast = networkConfig.fastTokens;
  if (fast) {
    if ("fastUSD" in fast) {
      const t = fast.fastUSD!;
      return {
        name: "fastUSD",
        token: { fastTokenId: fromHex(t.fastTokenId), decimals: t.decimals },
      };
    }
    const keys = Object.keys(fast);
    if (keys.length === 1) {
      const name = keys[0]!;
      const t = fast[name]!;
      return {
        name,
        token: { fastTokenId: fromHex(t.fastTokenId), decimals: t.decimals },
      };
    }
    // Multiple entries, none called "fastUSD" — ambiguous, fall through.
  }

  const allset = networkConfig.allSet;
  if (allset) {
    const firstChain = Object.values(allset.chains)[0];
    if (firstChain) {
      const firstName = Object.keys(firstChain.tokens)[0];
      if (firstName) {
        const token = firstChain.tokens[firstName]!;
        return {
          name: firstName,
          token: {
            fastTokenId: fromHex(token.fastTokenId),
            decimals: token.decimals,
          },
        };
      }
    }
  }

  throw new TokenNotFoundError({ token: "<default>" });
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
