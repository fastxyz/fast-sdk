import type { NetworkConfig } from '../config/bundled.js';
import { TokenNotFoundError, UnsupportedChainError } from '../errors/index.js';

export interface ResolvedToken {
  readonly fastTokenId: Uint8Array;
  readonly decimals: number;
  readonly evmAddress?: string;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Resolves a token name to its fastTokenId, decimals, and (for bridge tokens) evmAddress.
 *
 * If `chain` is provided (bridge route), look up the token in that specific chain's config.
 * If `chain` is omitted (Fast→Fast route), scan all chains and return the first match.
 */
export function resolveToken(tokenName: string, networkConfig: NetworkConfig, chain?: string): ResolvedToken {
  const allset = networkConfig.allset;
  if (!allset) {
    throw new TokenNotFoundError({ name: tokenName });
  }

  if (chain) {
    const chainConfig = allset.chains[chain];
    if (!chainConfig) {
      throw new UnsupportedChainError({ chain });
    }
    const token = chainConfig.tokens[tokenName];
    if (!token) {
      throw new TokenNotFoundError({ name: tokenName });
    }
    return {
      fastTokenId: hexToBytes(token.fastTokenId),
      decimals: token.decimals,
      evmAddress: token.evmAddress,
    };
  }

  // Fast→Fast: scan all chains for the token
  for (const chainConfig of Object.values(allset.chains)) {
    const token = chainConfig.tokens[tokenName];
    if (token) {
      return {
        fastTokenId: hexToBytes(token.fastTokenId),
        decimals: token.decimals,
      };
    }
  }

  throw new TokenNotFoundError({ name: tokenName });
}
