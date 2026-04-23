import type { FastNetwork } from "./types.js";

export const testnet = {
  url: "https://testnet.api.fast.xyz/proxy-rest",
  explorerUrl: "https://testnet.explorer.fast.xyz",
  networkId: "fast:testnet",
  defaultToken: {
    tokenId: "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46",
    symbol: "testUSDC",
    decimals: 6,
  },
} satisfies FastNetwork;
