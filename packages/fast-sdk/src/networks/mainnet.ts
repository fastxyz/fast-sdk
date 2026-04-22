import type { FastNetwork } from "./types.js";

export const mainnet: FastNetwork = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  defaultToken: {
    tokenId: "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    symbol: "USDC",
    decimals: 6,
  },
};
