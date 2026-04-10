import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcCallEffect } from "../../src/core/network/rpc";
import { run } from "../../src/core/run";
import { JsonRpcProtocolError, RpcTimeoutError } from "../../src/index";

function mockFetch(response: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        text: () => Promise.resolve(JSON.stringify(response)),
      }),
    ),
  );
}

describe("rpcCallEffect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns result from successful JSON-RPC response", async () => {
    mockFetch({ jsonrpc: "2.0", id: 1, result: { foo: "bar" } });
    const result = await run(rpcCallEffect("http://localhost", "test", {}));
    expect(result).toEqual({ foo: "bar" });
  });

  it("returns null result when result is null", async () => {
    mockFetch({ jsonrpc: "2.0", id: 1, result: null });
    const result = await run(rpcCallEffect("http://localhost", "test", {}));
    expect(result).toBeNull();
  });

  it("sends correct JSON-RPC request format", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        text: () =>
          Promise.resolve(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }),
          ),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await run(
      rpcCallEffect("http://localhost:9999", "myMethod", { key: "value" }),
    );

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:9999", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining('"method":"myMethod"'),
    });
  });

  it("throws RpcTimeoutError on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    try {
      await run(rpcCallEffect("http://localhost", "slow_method", {}, 50));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RpcTimeoutError);
      if (e instanceof RpcTimeoutError) {
        expect(e.method).toBe("slow_method");
        expect(e.timeoutMs).toBe(50);
      }
    }
  });

  it("throws on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    await expect(
      run(rpcCallEffect("http://localhost", "test", {})),
    ).rejects.toThrow();
  });

  it("throws on malformed JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          text: () => Promise.resolve("not json"),
        }),
      ),
    );

    await expect(
      run(rpcCallEffect("http://localhost", "test", {})),
    ).rejects.toThrow();
  });

  it("throws on JSON-RPC error response", async () => {
    mockFetch({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });

    try {
      await run(rpcCallEffect("http://localhost", "test", {}));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(JsonRpcProtocolError);
    }
  });

  it("handles bigint values in response", async () => {
    // json-with-bigint should handle large numbers
    mockFetch({
      jsonrpc: "2.0",
      id: 1,
      // biome-ignore lint: intentional test of bigint handling
      result: { balance: 999999999999999999 },
    });

    const result = (await run(
      rpcCallEffect("http://localhost", "test", {}),
    )) as { balance: number | bigint };
    expect(result).toHaveProperty("balance");
  });
});
