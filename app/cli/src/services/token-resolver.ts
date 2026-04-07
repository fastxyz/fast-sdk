import { fromHex } from "@fastxyz/fast-sdk";
import type { NetworkConfig } from "../schemas/networks.js";
import { TokenNotFoundError, UnsupportedChainError } from "../errors/index.js";

export interface ResolvedToken {
  readonly fastTokenId: Uint8Array;
  readonly decimals: number;
  readonly evmAddress?: string;
}

/**
 * Resolves a token name to its fastTokenId, decimals, and (for bridge tokens) evmAddress.
 *
 * If `chain` is provided (bridge route), look up the token in that specific chain's config.
 * If `chain` is omitted (Fast→Fast route), scan all chains and return the first match.
 */
export function resolveToken(
  tokenName: string,
  networkConfig: NetworkConfig,
  chain?: string,
): ResolvedToken {
  const allset = networkConfig.allSet;
  if (!allset) {
    throw new TokenNotFoundError({ token: tokenName });
  }

  if (chain) {
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

  // Fast→Fast: scan all chains for the token
  for (const chainConfig of Object.values(allset.chains)) {
    const token = chainConfig.tokens[tokenName];
    if (token) {
      return {
        fastTokenId: fromHex(token.fastTokenId),
        decimals: token.decimals,
      };
    }
  }

  throw new TokenNotFoundError({ token: tokenName });
}
