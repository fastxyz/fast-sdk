import { describe, expect, it } from "vitest";

import { getNetworkConfig } from "../../src/server/utils.js";

describe("server network config", () => {
  it("throws for unknown payment networks", () => {
    expect(() => getNetworkConfig("base-mainnet")).toThrow(
      "Unsupported payment network: base-mainnet",
    );
  });

  it("returns known configs unchanged", () => {
    expect(getNetworkConfig("base").asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });
});
