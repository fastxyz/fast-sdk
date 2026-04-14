import { afterEach, describe, expect, it, vi } from "vitest";
import { restCallEffect } from "../../src/core/network/rest";
import { run } from "../../src/core/run";
import {
  BcsEncodeError,
  FastProvider,
  GeneralError,
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

const provider = new FastProvider({ url: "http://localhost:9999" });
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
