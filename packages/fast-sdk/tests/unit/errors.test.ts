import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcCallEffect } from "../../src/core/network/rpc";
import { run } from "../../src/core/run";
import {
  BcsEncodeError,
  FastProvider,
  FaucetDisabledError,
  GeneralError,
  InsufficientFundingError,
  InvalidRequestError,
  JsonRpcProtocolError,
  ProxyUnexpectedNonceError,
  RpcError,
  RpcTimeoutError,
  UnexpectedNonceError,
  ValidatorGenericError,
} from "../../src/index";

function mockRpcError(error: {
  code: number;
  message: string;
  data?: unknown;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        text: () =>
          Promise.resolve(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error,
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

const provider = new FastProvider({ rpcUrl: "http://localhost:9999" });
const faucetParams = {
  recipient: new Uint8Array(32),
  amount: 1n,
  tokenId: null,
};

describe("Error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Layer 0: Network / transport", () => {
    it("throws on network failure", async () => {
      mockNetworkError();
      await expect(provider.faucetDrip(faucetParams)).rejects.toThrow();
    });

    it("throws RpcTimeoutError on timeout", async () => {
      mockHangingFetch();
      try {
        await run(rpcCallEffect("http://localhost:9999", "test", {}, 50));
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(RpcTimeoutError);
        if (e instanceof RpcTimeoutError) {
          expect(e.method).toBe("test");
          expect(e.timeoutMs).toBe(50);
        }
      }
    });
  });

  describe("Layer 1: JSON-RPC protocol errors", () => {
    it("parses method not found (-32601)", async () => {
      mockRpcError({ code: -32601, message: "Method not found" });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(JsonRpcProtocolError);
        if (e instanceof JsonRpcProtocolError) {
          expect(e.code).toBe(-32601);
          expect(e.message).toBe("Method not found");
        }
      }
    });

    it("parses invalid params (-32602)", async () => {
      mockRpcError({ code: -32602, message: "Invalid params" });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(JsonRpcProtocolError);
      }
    });

    it("parses parse error (-32700)", async () => {
      mockRpcError({ code: -32700, message: "Parse error" });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(JsonRpcProtocolError);
      }
    });
  });

  describe("Layer 2: Proxy errors", () => {
    it("parses FaucetDisabled (-32001)", async () => {
      mockRpcError({
        code: -32001,
        message: "Faucet disabled",
        data: { FaucetDisabled: null },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(FaucetDisabledError);
      }
    });

    it("parses UnexpectedNonce (-32014) with structured data", async () => {
      mockRpcError({
        code: -32014,
        message: "expected nonce is 1 but tx has 2",
        data: { UnexpectedNonce: { tx_nonce: 2, expected_nonce: 1 } },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ProxyUnexpectedNonceError);
        if (e instanceof ProxyUnexpectedNonceError) {
          expect(e.txNonce).toBe(2n);
          expect(e.expectedNonce).toBe(1n);
        }
      }
    });

    it("parses InvalidRequest (-32015)", async () => {
      mockRpcError({
        code: -32015,
        message: "request error: bad params",
        data: { InvalidRequest: "bad params" },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidRequestError);
      }
    });

    it("parses GeneralError (-32000)", async () => {
      mockRpcError({
        code: -32000,
        message: "something went wrong",
        data: { GeneralError: "something went wrong" },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(GeneralError);
      }
    });
  });

  describe("Layer 3: FastSet/Validator errors", () => {
    it("parses UnexpectedNonce from validator", async () => {
      mockRpcError({
        code: -32002,
        message: "RPC error: unexpected nonce",
        data: {
          RpcError: { FastSet: { UnexpectedNonce: { expected_nonce: 5 } } },
        },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(UnexpectedNonceError);
        if (e instanceof UnexpectedNonceError) {
          expect(e.expectedNonce).toBe(5n);
        }
      }
    });

    it("parses InsufficientFunding from validator", async () => {
      mockRpcError({
        code: -32002,
        message: "RPC error: insufficient funding",
        data: {
          RpcError: {
            FastSet: { InsufficientFunding: { current_balance: 1000 } },
          },
        },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(InsufficientFundingError);
        if (e instanceof InsufficientFundingError) {
          expect(e.currentBalance).toBe(1000n);
        }
      }
    });

    it("falls back to ValidatorGenericError for unknown FastSet variant", async () => {
      mockRpcError({
        code: -32002,
        message: "RPC error: something",
        data: { RpcError: { Generic: "unknown validator error" } },
      });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ValidatorGenericError);
      }
    });
  });

  describe("Fallback: unknown error codes", () => {
    it("wraps unknown code in RpcError", async () => {
      mockRpcError({ code: -99999, message: "alien error" });
      try {
        await provider.faucetDrip(faucetParams);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(RpcError);
        if (e instanceof RpcError) {
          expect(e.code).toBe(-99999);
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

    it("JsonRpcProtocolError has code and message", () => {
      const err = new JsonRpcProtocolError({
        code: -32601,
        message: "Not found",
      });
      expect(err.code).toBe(-32601);
      expect(err.message).toBe("Not found");
      expect(err).toBeInstanceOf(Error);
    });

    it("BcsEncodeError has _tag", () => {
      const err = new BcsEncodeError({ cause: new Error("bad") });
      expect(err._tag).toBe("BcsEncodeError");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
