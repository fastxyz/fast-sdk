import { describe, expect, it } from "vitest";
import {
  FastSetErrorData,
  JsonRpcError,
  ProxyErrorData,
} from "../../src/errors/fastset.ts";
import { decodeSync, encodeSync } from "./helpers.ts";

describe("FastSetErrorData", () => {
  it("decodes UnexpectedNonce", () => {
    const result = decodeSync(FastSetErrorData, {
      UnexpectedNonce: { expected_nonce: 5 },
    });
    expect(result).toEqual({
      type: "UnexpectedNonce",
      value: { expectedNonce: 5n },
    });
  });

  it("decodes InsufficientFunding", () => {
    const result = decodeSync(FastSetErrorData, {
      InsufficientFunding: { current_balance: 1000 },
    });
    expect(result).toEqual({
      type: "InsufficientFunding",
      value: { currentBalance: 1000n },
    });
  });

  it("decodes InvalidSignature", () => {
    const result = decodeSync(FastSetErrorData, {
      InvalidSignature: { error: "bad sig" },
    });
    expect(result).toEqual({
      type: "InvalidSignature",
      value: { error: "bad sig" },
    });
  });

  it("decodes NonSubmittableOperation", () => {
    const result = decodeSync(FastSetErrorData, {
      NonSubmittableOperation: { reason: "nope" },
    });
    expect(result).toEqual({
      type: "NonSubmittableOperation",
      value: { reason: "nope" },
    });
  });

  it("decodes MissingEarlierConfirmations", () => {
    const result = decodeSync(FastSetErrorData, {
      MissingEarlierConfirmations: { current_nonce: 3 },
    });
    expect(result).toEqual({
      type: "MissingEarlierConfirmations",
      value: { currentNonce: 3n },
    });
  });

  it("decodes CertificateTooYoung", () => {
    const result = decodeSync(FastSetErrorData, {
      CertificateTooYoung: { resend_after_nanos: 1000000 },
    });
    expect(result).toEqual({
      type: "CertificateTooYoung",
      value: { resendAfterNanos: 1000000n },
    });
  });

  it("decodes PreviousTransactionMustBeConfirmedFirst", () => {
    const result = decodeSync(FastSetErrorData, {
      PreviousTransactionMustBeConfirmedFirst: { pending_confirmation: {} },
    });
    expect(result.type).toBe("PreviousTransactionMustBeConfirmedFirst");
  });

  it("rejects unknown variant", () => {
    expect(() => decodeSync(FastSetErrorData, { Foo: {} })).toThrow();
  });

  it("round-trips UnexpectedNonce", () => {
    const decoded = decodeSync(FastSetErrorData, {
      UnexpectedNonce: { expected_nonce: 10 },
    });
    const encoded = encodeSync(FastSetErrorData, decoded);
    expect(encoded).toEqual({
      UnexpectedNonce: { expected_nonce: 10n },
    });
  });
});

describe("JsonRpcError", () => {
  it("decodes FastSet with nested error", () => {
    const result = decodeSync(JsonRpcError, {
      FastSet: { UnexpectedNonce: { expected_nonce: 5 } },
    });
    expect(result.type).toBe("FastSet");
    expect(result.value).toEqual({
      type: "UnexpectedNonce",
      value: { expectedNonce: 5n },
    });
  });

  it("decodes Generic error", () => {
    const result = decodeSync(JsonRpcError, { Generic: "some error" });
    expect(result).toEqual({ type: "Generic", value: "some error" });
  });

  it("round-trips Generic", () => {
    const decoded = decodeSync(JsonRpcError, { Generic: "oops" });
    const encoded = encodeSync(JsonRpcError, decoded);
    expect(encoded).toEqual({ Generic: "oops" });
  });
});

describe("ProxyErrorData", () => {
  it("decodes unit variant FaucetDisabled", () => {
    const result = decodeSync(ProxyErrorData, "FaucetDisabled");
    expect(result).toEqual({ type: "FaucetDisabled" });
  });

  it("decodes unit variant TooManyCertificatesRequested", () => {
    const result = decodeSync(ProxyErrorData, "TooManyCertificatesRequested");
    expect(result).toEqual({ type: "TooManyCertificatesRequested" });
  });

  it("decodes GeneralError", () => {
    const result = decodeSync(ProxyErrorData, { GeneralError: "oops" });
    expect(result).toEqual({ type: "GeneralError", value: "oops" });
  });

  it("decodes InvalidRequest", () => {
    const result = decodeSync(ProxyErrorData, {
      InvalidRequest: "bad params",
    });
    expect(result).toEqual({ type: "InvalidRequest", value: "bad params" });
  });

  it("decodes DatabaseError", () => {
    const result = decodeSync(ProxyErrorData, { DatabaseError: "db failed" });
    expect(result).toEqual({ type: "DatabaseError", value: "db failed" });
  });

  it("decodes UnexpectedNonce with nonce fields", () => {
    const result = decodeSync(ProxyErrorData, {
      UnexpectedNonce: { tx_nonce: 2, expected_nonce: 1 },
    });
    expect(result).toEqual({
      type: "UnexpectedNonce",
      value: { txNonce: 2n, expectedNonce: 1n },
    });
  });

  it("decodes deeply nested RpcError → FastSet → InsufficientFunding", () => {
    const result = decodeSync(ProxyErrorData, {
      RpcError: {
        FastSet: { InsufficientFunding: { current_balance: 999 } },
      },
    });
    expect(result.type).toBe("RpcError");
    // @ts-expect-error - value is unknown at this level
    const rpcErr = result.value as { type: string; value: unknown };
    expect(rpcErr.type).toBe("FastSet");
    const fastSetErr = rpcErr.value as { type: string; value: unknown };
    expect(fastSetErr.type).toBe("InsufficientFunding");
    expect(fastSetErr.value).toEqual({ currentBalance: 999n });
  });

  it("encodes FaucetDisabled back to string", () => {
    const decoded = decodeSync(ProxyErrorData, "FaucetDisabled");
    const encoded = encodeSync(ProxyErrorData, decoded);
    expect(encoded).toBe("FaucetDisabled");
  });

  it("encodes GeneralError back to keyed object", () => {
    const decoded = decodeSync(ProxyErrorData, { GeneralError: "err" });
    const encoded = encodeSync(ProxyErrorData, decoded);
    expect(encoded).toEqual({ GeneralError: "err" });
  });
});
