import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { bundledNetworks } from "../../src/config/networks.js";
import { NetworkConfigSchema } from "../../src/schemas/networks.js";

describe("NetworkConfigSchema", () => {
  it("accepts a config with defaultToken", () => {
    const config = {
      url: "https://example",
      explorerUrl: "https://explorer",
      networkId: "fast:mainnet",
      defaultToken: {
        tokenId: "0xabc",
        symbol: "fastUSD",
        decimals: 6,
      },
    };
    const parsed = Schema.decodeUnknownSync(NetworkConfigSchema)(config);
    expect(parsed.defaultToken?.symbol).toBe("fastUSD");
    expect(parsed.defaultToken?.tokenId).toBe("0xabc");
    expect(parsed.defaultToken?.decimals).toBe(6);
  });

  it("accepts a config without defaultToken (optional field)", () => {
    const config = {
      url: "https://example",
      explorerUrl: "https://explorer",
      networkId: "fast:mainnet",
    };
    const parsed = Schema.decodeUnknownSync(NetworkConfigSchema)(config);
    expect(parsed.defaultToken).toBeUndefined();
  });
});

describe("bundledNetworks", () => {
  it("mainnet.defaultToken matches the SDK USDC", () => {
    const mainnet = bundledNetworks.mainnet;
    expect(mainnet.defaultToken?.symbol).toBe("USDC");
    expect(mainnet.defaultToken?.decimals).toBe(6);
    expect(mainnet.defaultToken?.tokenId).toMatch(/^0xc655a123/);
  });

  it("testnet.defaultToken matches the SDK testUSDC", () => {
    const testnet = bundledNetworks.testnet;
    expect(testnet.defaultToken?.symbol).toBe("testUSDC");
    expect(testnet.defaultToken?.decimals).toBe(6);
    expect(testnet.defaultToken?.tokenId).toMatch(/^0xd73a0679/);
  });
});
