import type { FastNetwork } from "./types.js";

export const mainnet = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  defaultToken: {
    tokenId: "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    symbol: "fastUSD",
    decimals: 6,
  },
} satisfies FastNetwork;
