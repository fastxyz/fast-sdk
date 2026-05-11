import { describe, expect, it } from "vitest";
import { buildRampUrl } from "../../src/commands/fund/usdc/fiat-url.js";

describe("buildRampUrl", () => {
  it("encodes a plain fast address as the to= query param", () => {
    expect(buildRampUrl("fast1abc")).toBe("https://ramp.fast.xyz/?to=fast1abc");
  });

  it("encodes special characters so an injected `&to=` cannot smuggle a second param", () => {
    expect(buildRampUrl("fast1x&to=fast1attacker")).toBe(
      "https://ramp.fast.xyz/?to=fast1x%26to%3Dfast1attacker",
    );
  });
});
