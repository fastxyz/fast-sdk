import { describe, expect, it } from "vitest";
import type { NetworkConfig } from "../../src/schemas/networks.js";
import {
  customCfgWithoutDefaultToken,
  mainnetCfg,
  testnetCfg,
} from "../fixtures/networks.js";

/**
 * Mirrors the inline `args.token ?? network.defaultToken?.symbol` pattern in
 * `send.ts`. Pure name-selection, without invoking the full Effect handler.
 */
function pickName(
  argToken: string | undefined,
  network: NetworkConfig,
): string | undefined {
  return argToken ?? network.defaultToken?.symbol;
}

describe("send default-token selection", () => {
  it("explicit --token wins", () => {
    expect(pickName("USDC", mainnetCfg)).toBe("USDC");
  });

  it("omitted on mainnet defaults to fastUSD", () => {
    expect(pickName(undefined, mainnetCfg)).toBe("fastUSD");
  });

  it("omitted on testnet defaults to testUSDC", () => {
    expect(pickName(undefined, testnetCfg)).toBe("testUSDC");
  });

  it("omitted on custom network without defaultToken returns undefined", () => {
    expect(pickName(undefined, customCfgWithoutDefaultToken)).toBeUndefined();
  });
});
