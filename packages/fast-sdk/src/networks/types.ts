import type { NetworkId } from "@fastxyz/schema";

/** A Fast network definition. Analogous to viem's `Chain`. */
export interface FastNetwork {
  /** Proxy REST API base URL. */
  url: string;
  /** Block explorer base URL. */
  explorerUrl: string;
  /** Network identifier, e.g. `"fast:mainnet"`. */
  networkId: NetworkId;
}
