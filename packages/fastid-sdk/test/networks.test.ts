import { afterEach, describe, expect, it } from "vitest";

import {
  InsufficientFundsError,
  NonceConflictError,
  asInsufficientFunds,
  asNonceConflict,
} from "../src/errors.js";
import { networkFor } from "../src/networks.js";

const originalOrigin = process.env.ID_SDK_ORIGIN;
const originalProxy = process.env.ID_SDK_PROXY;

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.ID_SDK_ORIGIN;
  else process.env.ID_SDK_ORIGIN = originalOrigin;
  if (originalProxy === undefined) delete process.env.ID_SDK_PROXY;
  else process.env.ID_SDK_PROXY = originalProxy;
});

describe("networkFor", () => {
  it("maps the two public networks to their id origin and public proxy", () => {
    expect(networkFor("fast:mainnet")).toEqual({
      networkId: "fast:mainnet",
      idOrigin: "https://id.fast.xyz",
      proxyUrl: "https://api.fast.xyz/proxy",
    });
    expect(networkFor("fast:testnet")).toEqual({
      networkId: "fast:testnet",
      idOrigin: "https://testnet.id.fast.xyz",
      proxyUrl: "https://testnet.api.fast.xyz/proxy",
    });
  });

  it("throws on an unknown network rather than guessing", () => {
    expect(() => networkFor("fast:devnet")).toThrow(/unknown network/i);
  });

  it("allows explicit testnet overrides after validating the network", () => {
    process.env.ID_SDK_ORIGIN = "http://127.0.0.1:3000/";
    process.env.ID_SDK_PROXY = "http://127.0.0.1:4000/proxy/";

    expect(networkFor("fast:testnet")).toEqual({
      networkId: "fast:testnet",
      idOrigin: "http://127.0.0.1:3000",
      proxyUrl: "http://127.0.0.1:4000/proxy",
    });
    expect(() => networkFor("fast:devnet")).toThrow(/unknown network/i);
  });

  it("never redirects mainnet through test overrides", () => {
    process.env.ID_SDK_ORIGIN = "http://127.0.0.1:3000/";
    process.env.ID_SDK_PROXY = "http://127.0.0.1:4000/proxy/";

    expect(networkFor("fast:mainnet")).toEqual({
      networkId: "fast:mainnet",
      idOrigin: "https://id.fast.xyz",
      proxyUrl: "https://api.fast.xyz/proxy",
    });
  });
});

describe("tagged Fast SDK error normalization", () => {
  it("normalizes nonce conflicts by _tag across effect copies", () => {
    const cause = { _tag: "ProxyUnexpectedNonceError", expectedNonce: 9n };
    const error = asNonceConflict(cause);

    expect(error).toBeInstanceOf(NonceConflictError);
    expect(error?.expectedNonce).toBe(9n);
    expect(error?.cause).toBe(cause);
    expect(asNonceConflict({ _tag: "SomethingElse" })).toBeNull();
  });

  it("normalizes the stable insufficient-fee details variant", () => {
    const cause = { details: { InsufficientFundingForFee: {} } };
    const error = asInsufficientFunds(cause, "testUSDC");

    expect(error).toBeInstanceOf(InsufficientFundsError);
    expect(error?.symbol).toBe("testUSDC");
    expect(error?.cause).toBe(cause);
    expect(asInsufficientFunds({ details: {} }, "testUSDC")).toBeNull();
  });
});
