import type { NetworkId } from "@fastxyz/schema";

/** A token on the Fast network. */
export interface FastToken {
  /** Token identifier (hex), e.g. `"0xc655a1..."`. */
  tokenId: string;
  /** Token symbol, e.g. `"USDC"`. */
  symbol: string;
  /** Number of decimal places. */
  decimals: number;
}

/** A Fast network definition. Analogous to viem's `Chain`. */
export interface FastNetwork {
  /** Proxy REST API base URL. */
  url: string;
  /** Block explorer base URL. */
  explorerUrl?: string;
  /** Network identifier, e.g. `"fast:mainnet"`. */
  networkId: NetworkId;
  /** Default token for this network (e.g. USDC on mainnet, testUSDC on testnet). */
  token?: FastToken;
}
