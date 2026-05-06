import { describe, expect, it } from "vitest";
import { labelAssetForPayment } from "../../src/commands/pay-asset-label.js";
import type { NetworkConfig } from "../../src/schemas/networks.js";

const MAINNET: NetworkConfig = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
  fastTokens: {
    fastUSD: {
      fastTokenId:
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      decimals: 6,
    },
  },
};

describe("labelAssetForPayment", () => {
  it("returns the registered token name when asset matches", () => {
    expect(
      labelAssetForPayment(
        MAINNET,
        "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
      ),
    ).toBe("fastUSD");
  });

  it("returns 'unknown' when asset is undefined", () => {
    expect(labelAssetForPayment(MAINNET, undefined)).toBe("unknown");
  });

  it("returns the short hex when asset is unknown", () => {
    expect(labelAssetForPayment(MAINNET, "0xdeadbeefcafe1234")).toBe(
      "0xdeadbeefcafe1234",
    );
  });

  it("returns the empty-string fallback as 'unknown'", () => {
    expect(labelAssetForPayment(MAINNET, "")).toBe("unknown");
  });
});
