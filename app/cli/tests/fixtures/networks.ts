import type { NetworkConfig } from "../../src/schemas/networks.js";

/**
 * Shared NetworkConfig fixtures for CLI tests.
 *
 * Mirrors the shapes used by Task 4's resolver tests so default-token,
 * rewrap, and resolver tests share one source of truth.
 */

export const mainnetCfg: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet" as const,
  defaultToken: {
    tokenId:
      "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    symbol: "fastUSD",
    decimals: 6,
  },
  allSet: {
    crossSignUrl: "https://cross-sign.allset.fast.xyz",
    portalApiUrl: "https://allset.fast.xyz/api",
    chains: {
      arbitrum: {
        chainId: 42161,
        bridgeContract: "0xBRIDGE",
        fastBridgeAddress: "fast1bridge",
        relayerUrl: "https://relayer",
        evmRpcUrl: "https://rpc",
        evmExplorerUrl: "https://arbiscan.io",
        tokens: {
          USDC: {
            evmAddress: "0xUSDC_ARB",
            fastTokenId:
              "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
            decimals: 6,
          },
        },
      },
    },
  },
};

export const testnetCfg: NetworkConfig = {
  url: "https://testnet.api.fast.xyz/proxy-rest",
  explorerUrl: "https://testnet.explorer.fast.xyz",
  networkId: "fast:testnet" as const,
  defaultToken: {
    tokenId:
      "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46",
    symbol: "testUSDC",
    decimals: 6,
  },
  allSet: {
    crossSignUrl: "https://testnet.cross-sign.allset.fast.xyz",
    portalApiUrl: "https://testnet.allset.fast.xyz/api",
    chains: {
      "arbitrum-sepolia": {
        chainId: 421614,
        bridgeContract: "0xbridge",
        fastBridgeAddress: "fast1bridge",
        relayerUrl: "https://relay/arb",
        evmRpcUrl: "https://rpc/arb",
        evmExplorerUrl: "https://sepolia.arbiscan.io",
        tokens: {
          testUSDC: {
            evmAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
            fastTokenId:
              "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46",
            decimals: 6,
          },
        },
      },
    },
  },
};

export const customCfgWithoutDefaultToken: NetworkConfig = {
  url: "https://x",
  explorerUrl: "https://y",
  networkId: "fast:mainnet" as const,
  allSet: {
    crossSignUrl: "https://x",
    portalApiUrl: "https://y",
    chains: {
      base: {
        chainId: 8453,
        bridgeContract: "0xB",
        fastBridgeAddress: "fast1b",
        relayerUrl: "https://r",
        evmRpcUrl: "https://rpc",
        evmExplorerUrl: "https://e",
        tokens: {
          USDC: { evmAddress: "0xU", fastTokenId: "0xc655a123", decimals: 6 },
        },
      },
    },
  },
};
