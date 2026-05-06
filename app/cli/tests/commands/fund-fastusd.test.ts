import { describe, expect, it } from "vitest";
import { buildFundFastUsdUrl } from "../../src/commands/fund/fastusd-url.js";

describe("buildFundFastUsdUrl", () => {
  it("emits to= when only address is provided", () => {
    expect(buildFundFastUsdUrl("fast1abc", undefined)).toBe(
      "https://app.fast.xyz/send?to=fast1abc",
    );
  });

  it("emits both to= and amount= when both are provided", () => {
    expect(buildFundFastUsdUrl("fast1abc", "10")).toBe(
      "https://app.fast.xyz/send?to=fast1abc&amount=10",
    );
  });

  it("preserves a decimal amount unchanged", () => {
    expect(buildFundFastUsdUrl("fast1abc", "10.5")).toBe(
      "https://app.fast.xyz/send?to=fast1abc&amount=10.5",
    );
  });

  it("URL-encodes special characters in the address", () => {
    expect(buildFundFastUsdUrl("fast1abc def", "10")).toBe(
      "https://app.fast.xyz/send?to=fast1abc+def&amount=10",
    );
  });
});
