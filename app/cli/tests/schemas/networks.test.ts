import { Schema } from "effect";
import { describe, expect, it } from "vitest";
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
