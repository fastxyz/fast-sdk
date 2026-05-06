import { describe, expect, it } from "vitest";
import { selectSendTokenName } from "../../src/commands/send-token-helper.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

const MAINNET: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  allSet: {
    crossSignUrl: "https://cross-sign.allset.fast.xyz",
    portalApiUrl: "https://allset.fast.xyz/api",
    chains: {
      ethereum: {
        chainId: 1,
        bridgeContract: "0xb",
        fastBridgeAddress: "fast1b",
        relayerUrl: "https://r/eth",
        evmRpcUrl: "https://rpc/eth",
        evmExplorerUrl: "https://etherscan.io",
        tokens: {
          USDC: {
            evmAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            fastTokenId:
              "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
            decimals: 6,
          },
        },
      },
    },
  },
  fastTokens: {
    fastUSD: {
      fastTokenId:
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      decimals: 6,
    },
  },
};

const TESTNET: NetworkConfig = {
  ...MAINNET,
  fastTokens: undefined,
  allSet: {
    ...MAINNET.allSet!,
    chains: {
      "arbitrum-sepolia": {
        ...MAINNET.allSet!.chains.ethereum!,
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

describe("selectSendTokenName (send default-token logic)", () => {
  it("returns explicit token when provided (mainnet)", () => {
    expect(selectSendTokenName("fastUSDC", MAINNET, undefined)).toBe("fastUSDC");
  });

  it("returns fastUSD on mainnet when token is omitted and no chain", () => {
    expect(selectSendTokenName(undefined, MAINNET, undefined)).toBe("fastUSD");
  });

  it("returns testUSDC on testnet when token is omitted and no chain", () => {
    expect(selectSendTokenName(undefined, TESTNET, undefined)).toBe("testUSDC");
  });

  it("returns first chain token when token is omitted and chain context exists (mainnet)", () => {
    expect(selectSendTokenName(undefined, MAINNET, "ethereum")).toBe("USDC");
  });

  it("returns first chain token when token is omitted and chain context exists (testnet)", () => {
    expect(selectSendTokenName(undefined, TESTNET, "arbitrum-sepolia")).toBe(
      "testUSDC",
    );
  });

  it("returns explicit token even when chain context is provided", () => {
    expect(selectSendTokenName("USDT", MAINNET, "ethereum")).toBe("USDT");
  });
});
