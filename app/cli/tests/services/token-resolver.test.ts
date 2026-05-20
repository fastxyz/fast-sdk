import { describe, expect, it } from "vitest";
import {
  lookupTokenNameById,
  resolveToken,
  tokenIsKnownOnNetwork,
} from "../../src/services/token-resolver.js";
import { TokenNotFoundError, UnsupportedChainError } from "../../src/errors/index.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";
import {
  customCfgWithoutDefaultToken,
  mainnetCfg,
} from "../fixtures/networks.js";

const MAINNET: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  defaultToken: {
    tokenId: "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    symbol: "fastUSD",
    decimals: 6,
  },
  allSet: {
    crossSignUrl: "https://cross-sign.allset.fast.xyz",
    portalApiUrl: "https://allset.fast.xyz/api",
    chains: {
      ethereum: {
        chainId: 1,
        bridgeContract: "0xbridge",
        fastBridgeAddress: "fast1bridge",
        relayerUrl: "https://relay/eth",
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
};

const TESTNET: NetworkConfig = {
  url: "https://testnet.api.fast.xyz/proxy-rest",
  explorerUrl: "https://testnet.explorer.fast.xyz",
  networkId: "fast:testnet",
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

describe("resolveToken", () => {
  it("resolves a chain-scoped token (bridge route)", () => {
    const r = resolveToken("USDC", MAINNET, "ethereum");
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("throws UnsupportedChainError for an unknown chain", () => {
    expect(() => resolveToken("USDC", MAINNET, "polygon")).toThrow(
      UnsupportedChainError,
    );
  });

  it("throws TokenNotFoundError when chain exists but token does not", () => {
    expect(() => resolveToken("WBTC", MAINNET, "ethereum")).toThrow(
      TokenNotFoundError,
    );
  });

  it("resolves the default token without chain context (mainnet)", () => {
    const r = resolveToken("fastUSD", MAINNET);
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBeUndefined();
  });

  it("falls back to chain scan when token is not the defaultToken (mainnet)", () => {
    const r = resolveToken("USDC", MAINNET);
    expect(r.decimals).toBe(6);
  });

  it("falls back to chain scan when defaultToken is absent (testnet)", () => {
    const r = resolveToken("testUSDC", TESTNET);
    expect(r.decimals).toBe(6);
  });

  it("ignores the defaultToken when chain context is given (mainnet)", () => {
    expect(() => resolveToken("fastUSD", MAINNET, "ethereum")).toThrow(
      TokenNotFoundError,
    );
  });

  it("throws TokenNotFoundError when chain arg is given but allSet is absent", () => {
    const cfg: NetworkConfig = { url: "x", explorerUrl: "x", networkId: "x" };
    expect(() => resolveToken("USDC", cfg, "ethereum")).toThrow(TokenNotFoundError);
  });
});

describe("lookupTokenNameById", () => {
  it("returns the defaultToken symbol when its id matches (mainnet)", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    );
    expect(name).toBe("fastUSD");
  });

  it("returns a chain-scoped token name when its fastTokenId matches", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    );
    expect(name).toBe("USDC");
  });

  it("matches case-insensitively on hex value", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "0xC655A12330DA6AF361D281B197996D2BC135AAED3B66278E729C2222291E9130",
    );
    expect(name).toBe("USDC");
  });

  it("strips a leading 0x consistently on input", () => {
    const name = lookupTokenNameById(
      MAINNET,
      "c655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    );
    expect(name).toBe("USDC");
  });

  it("returns undefined when no entry matches", () => {
    const name = lookupTokenNameById(MAINNET, "0xdeadbeef");
    expect(name).toBeUndefined();
  });
});

describe("resolveToken — defaultToken consultation", () => {
  it("returns fastUSD via defaultToken short-circuit (no chain)", () => {
    const r = resolveToken("fastUSD", mainnetCfg);
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBeUndefined();
    expect(r.fastTokenId.length).toBeGreaterThan(0);
  });

  it("falls through to chain scan for non-default tokens (no chain)", () => {
    const r = resolveToken("USDC", mainnetCfg);
    expect(r.decimals).toBe(6);
    expect(r.evmAddress).toBeUndefined();
  });

  it("throws TokenNotFoundError when token is not in defaultToken and not in any chain", () => {
    expect(() => resolveToken("USDD", mainnetCfg)).toThrow(/Unknown token/);
  });

  it("throws TokenNotFoundError when network has no defaultToken and token is unknown", () => {
    expect(() => resolveToken("fastUSD", customCfgWithoutDefaultToken)).toThrow(
      /Unknown token/,
    );
  });

  it("chain context — fastUSD on arbitrum throws TokenNotFoundError (resolver stays narrow)", () => {
    expect(() => resolveToken("fastUSD", mainnetCfg, "arbitrum")).toThrow(
      /Unknown token/,
    );
  });

  it("chain context — USDC on arbitrum returns ResolvedToken with evmAddress", () => {
    const r = resolveToken("USDC", mainnetCfg, "arbitrum");
    expect(r.evmAddress).toBe("0xUSDC_ARB");
    expect(r.decimals).toBe(6);
  });
});

describe("tokenIsKnownOnNetwork", () => {
  it("true for the network's defaultToken symbol", () => {
    expect(tokenIsKnownOnNetwork(mainnetCfg, "fastUSD")).toBe(true);
  });

  it("true for a token in any chain", () => {
    expect(tokenIsKnownOnNetwork(mainnetCfg, "USDC")).toBe(true);
  });

  it("false for an unknown token", () => {
    expect(tokenIsKnownOnNetwork(mainnetCfg, "USDD")).toBe(false);
  });

  it("false when network has no defaultToken and token only appears as unknown", () => {
    expect(tokenIsKnownOnNetwork(customCfgWithoutDefaultToken, "fastUSD")).toBe(
      false,
    );
  });
});

describe("lookupTokenNameById — defaultToken fallback", () => {
  it("returns the defaultToken symbol when id matches", () => {
    const name = lookupTokenNameById(
      mainnetCfg,
      "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
    );
    expect(name).toBe("fastUSD");
  });

  it("prefers a chain match over defaultToken when both exist", () => {
    const name = lookupTokenNameById(
      mainnetCfg,
      "0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130",
    );
    expect(name).toBe("USDC");
  });

  it("returns undefined when neither chain nor defaultToken matches", () => {
    expect(lookupTokenNameById(mainnetCfg, "0xdeadbeef")).toBeUndefined();
  });
});
