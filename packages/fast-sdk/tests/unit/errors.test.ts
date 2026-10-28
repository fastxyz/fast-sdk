import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRestError } from "../../src/core/network/error";
import { restCallEffect } from "../../src/core/network/rest";
import { run } from "../../src/core/run";
import {
  BcsEncodeError,
  FastProvider,
  GeneralError,
  InsufficientFundingError,
  InvalidRequestError,
  IpRateLimitedError,
  NotFoundError,
  ProxyUnexpectedNonceError,
  RestError,
  RestTimeoutError,
  RpcTimeoutError,
  ServiceUnavailableError,
  UpstreamError,
} from "../../src/index";

function mockRestError(
  status: number,
  error: { code: string; message: string; details?: unknown },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error,
              meta: { timestamp: "2025-01-01T00:00:00Z" },
            }),
          ),
      }),
    ),
  );
}

function mockHangingFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
}

function mockNetworkError() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
  );
}

const provider = new FastProvider({ url: "http://localhost:9999", networkId: "fast:localnet" });
const accountParams = {
  address: "0000000000000000000000000000000000000000000000000000000000000001",
};

describe("Error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Layer 0: Network / transport", () => {
    it("throws on network failure", async () => {
      mockNetworkError();
      await expect(provider.getAccountInfo(accountParams)).rejects.toThrow();
    });

    it("throws RestTimeoutError on timeout", async () => {
      mockHangingFetch();
      try {
        await run(
          restCallEffect("http://localhost:9999", {
            method: "GET",
            path: "/v1/test",
            timeoutMs: 50,
          }),
        );
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(RestTimeoutError);
        if (e instanceof RestTimeoutError) {
          expect(e.path).toBe("/v1/test");
          expect(e.timeoutMs).toBe(50);
        }
      }
    });
  });

  describe("REST API errors", () => {
    it("parses UNEXPECTED_NONCE with structured details", async () => {
      mockRestError(409, {
        code: "UNEXPECTED_NONCE",
        message: "expected nonce is 1 but tx has 2",
        details: { tx_nonce: 2, expected_nonce: 1 },
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ProxyUnexpectedNonceError);
        if (e instanceof ProxyUnexpectedNonceError) {
          expect(e.txNonce).toBe(2n);
          expect(e.expectedNonce).toBe(1n);
        }
      }
    });

    it("parses INVALID_REQUEST", async () => {
      mockRestError(400, {
        code: "INVALID_REQUEST",
        message: "bad params",
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidRequestError);
      }
    });

    it("parses NOT_FOUND", async () => {
      mockRestError(404, {
        code: "NOT_FOUND",
        message: "resource not found",
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundError);
      }
    });

    it("parses INTERNAL_ERROR", async () => {
      mockRestError(500, {
        code: "INTERNAL_ERROR",
        message: "something went wrong",
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(GeneralError);
      }
    });

    it("parses IP_RATE_LIMITED", async () => {
      mockRestError(429, {
        code: "IP_RATE_LIMITED",
        message: "rate limited",
        details: { retry_after_secs: 30 },
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(IpRateLimitedError);
        if (e instanceof IpRateLimitedError) {
          expect(e.retryAfterSecs).toBe(30);
        }
      }
    });

    it("parses UPSTREAM_ERROR", async () => {
      mockRestError(502, {
        code: "UPSTREAM_ERROR",
        message: "validator down",
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(UpstreamError);
      }
    });

    it("parses SERVICE_UNAVAILABLE", async () => {
      mockRestError(503, {
        code: "SERVICE_UNAVAILABLE",
        message: "maintenance",
      });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceUnavailableError);
      }
    });
  });

  describe("Validator fee rejections", () => {
    const tokenId = [
      215, 58, 6, 121, 162, 190, 70, 152, 30, 42, 138, 237, 236, 217, 81, 200,
      182, 105, 14, 125, 95, 133, 2, 179, 78, 211, 255, 76, 194, 22, 59, 70,
    ];
    const call = () =>
      run(restCallEffect("http://localhost:9999", { method: "POST", path: "/v1/test" }));

    it("exposes the captured fee rejection as InsufficientFundingError", async () => {
      mockRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "validator rejected transaction: insufficient funds for fee",
        details: {
          InsufficientFundingForFee: {
            current_balance: "0",
            token_id: tokenId,
            needed: "1",
          },
        },
      });

      const error = await call().catch((error) => error);
      expect(error).toBeInstanceOf(InsufficientFundingError);
      expect(error).toMatchObject({
        _tag: "InsufficientFundingError",
        message: "validator rejected transaction: insufficient funds for fee",
        currentBalance: 0n,
        tokenId: new Uint8Array(tokenId),
        needed: 1n,
      });
    });

    it("preserves balances beyond Number.MAX_SAFE_INTEGER", async () => {
      mockRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "insufficient fee balance",
        details: {
          InsufficientFundingForFee: {
            current_balance: "9007199254740993",
            token_id: null,
            needed: "340282366920938463463374607431768211455",
          },
        },
      });

      const error = await call().catch((error) => error);
      expect(error).toBeInstanceOf(InsufficientFundingError);
      expect(error).toMatchObject({
        currentBalance: 9007199254740993n,
        tokenId: null,
        needed: 340282366920938463463374607431768211455n,
      });
    });

    it("accepts safe integer balances", async () => {
      mockRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "insufficient fee balance",
        details: {
          InsufficientFundingForFee: { current_balance: 0, token_id: null, needed: 1 },
        },
      });

      const error = await call().catch((error) => error);
      expect(error).toBeInstanceOf(InsufficientFundingError);
      expect(error).toMatchObject({ currentBalance: 0n, tokenId: null, needed: 1n });
    });

    it("preserves bigint balances already decoded from JSON", () => {
      const error = parseRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "insufficient fee balance",
        details: {
          InsufficientFundingForFee: {
            current_balance: 9007199254740993n,
            token_id: null,
            needed: 9007199254740994n,
          },
        },
      });
      expect(error).toBeInstanceOf(InsufficientFundingError);
      expect(error).toMatchObject({
        currentBalance: 9007199254740993n,
        needed: 9007199254740994n,
      });
    });

    it("does not coerce unsafe numeric balances", () => {
      const error = parseRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "insufficient fee balance",
        details: {
          InsufficientFundingForFee: {
            current_balance: Number.MAX_SAFE_INTEGER + 1,
            token_id: null,
            needed: "9007199254740993",
          },
        },
      });
      expect(error).toBeInstanceOf(RestError);
    });

    it.each([
      ["-9007199254740993", "1", -9007199254740993n, 1n],
      ["0", "-9007199254740993", 0n, -9007199254740993n],
      [-1, -2, -1n, -2n],
    ])("preserves signed Balance fields (%s, %s)", async (current, needed, balance, fee) => {
      mockRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "insufficient fee balance",
        details: {
          InsufficientFundingForFee: {
            current_balance: current,
            token_id: null,
            needed,
          },
        },
      });
      const error = await call().catch((error) => error);
      expect(error).toBeInstanceOf(InsufficientFundingError);
      expect(error).toMatchObject({ currentBalance: balance, needed: fee });
    });

    it("preserves negative bigint Balance fields", () => {
      const error = parseRestError(400, {
        code: "VALIDATOR_REJECTED",
        message: "insufficient fee balance",
        details: {
          InsufficientFundingForFee: {
            current_balance: -9007199254740993n,
            token_id: null,
            needed: -9007199254740994n,
          },
        },
      });
      expect(error).toBeInstanceOf(InsufficientFundingError);
      expect(error).toMatchObject({
        currentBalance: -9007199254740993n,
        needed: -9007199254740994n,
      });
    });

    it.each([
      undefined,
      null,
      [],
      "InsufficientFundingForFee",
      { OtherValidatorError: {} },
      { InsufficientFundingForFee: null },
      { InsufficientFundingForFee: {} },
      { InsufficientFundingForFee: { current_balance: "0", needed: "1" } },
      { InsufficientFundingForFee: { current_balance: "0", token_id: null } },
      ...[
        { current_balance: "not a balance" },
        { current_balance: "" },
        { current_balance: "-1.5" },
        { current_balance: null },
        { current_balance: 0.5 },
        { needed: false },
        { needed: "1.5" },
        { needed: "-1.5" },
        { token_id: [] },
        { token_id: [...tokenId.slice(0, 31), 256] },
        { token_id: [...tokenId.slice(0, 31), 0.5] },
        { token_id: "not token bytes" },
      ].map((overrides) => ({
        InsufficientFundingForFee: {
          current_balance: "0", token_id: null, needed: "1", ...overrides,
        },
      })),
    ])("keeps malformed or unknown details as RestError: %j", async (details) => {
      mockRestError(400, {
        code: "VALIDATOR_REJECTED", message: "validator rejection", details,
      });

      const error = await call().catch((error) => error);
      if (!(error instanceof RestError)) {
        expect.unreachable("Expected a RestError");
      }
      expect(error).toMatchObject({
        status: 400, code: "VALIDATOR_REJECTED", message: "validator rejection",
      });
      expect(error.details).toEqual(details);
    });
  });

  describe("Fallback: unknown error codes", () => {
    it("wraps unknown code in RestError", async () => {
      mockRestError(418, { code: "TEAPOT", message: "I'm a teapot" });
      try {
        await provider.getAccountInfo(accountParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(RestError);
        if (e instanceof RestError) {
          expect(e.status).toBe(418);
          expect(e.code).toBe("TEAPOT");
        }
      }
    });
  });

  describe("Error class properties", () => {
    it("keeps the existing InsufficientFundingError constructor compatible", () => {
      const error = new InsufficientFundingError({
        message: "insufficient funds",
        currentBalance: 0n,
      });
      expect(error).toMatchObject({ _tag: "InsufficientFundingError", currentBalance: 0n });
    });

    it("RpcTimeoutError has _tag, method, timeoutMs", () => {
      const err = new RpcTimeoutError({ method: "test", timeoutMs: 5000 });
      expect(err._tag).toBe("RpcTimeoutError");
      expect(err.method).toBe("test");
      expect(err.timeoutMs).toBe(5000);
      expect(err).toBeInstanceOf(Error);
    });

    it("RestTimeoutError has _tag, path, timeoutMs", () => {
      const err = new RestTimeoutError({
        path: "/v1/test",
        timeoutMs: 5000,
      });
      expect(err._tag).toBe("RestTimeoutError");
      expect(err.path).toBe("/v1/test");
      expect(err.timeoutMs).toBe(5000);
      expect(err).toBeInstanceOf(Error);
    });

    it("RestError has status, code, message", () => {
      const err = new RestError({
        status: 418,
        code: "TEAPOT",
        message: "I'm a teapot",
        details: null,
      });
      expect(err.status).toBe(418);
      expect(err.code).toBe("TEAPOT");
      expect(err).toBeInstanceOf(Error);
    });

    it("BcsEncodeError has _tag", () => {
      const err = new BcsEncodeError({ cause: new Error("bad") });
      expect(err._tag).toBe("BcsEncodeError");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
