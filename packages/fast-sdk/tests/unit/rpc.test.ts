import { afterEach, describe, expect, it, vi } from "vitest";
import { restCallEffect } from "../../src/core/network/rest";
import { run } from "../../src/core/run";
import { RestError, RestTimeoutError } from "../../src/index";

function mockFetch(ok: boolean, status: number, response: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok,
        status,
        text: () => Promise.resolve(JSON.stringify(response)),
      }),
    ),
  );
}

describe("restCallEffect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data from successful REST response", async () => {
    mockFetch(true, 200, {
      data: { foo: "bar" },
      meta: { timestamp: "2025-01-01T00:00:00Z" },
    });
    const result = await run(
      restCallEffect("http://localhost", { method: "GET", path: "/v1/test" }),
    );
    expect(result).toEqual({ foo: "bar" });
  });

  it("returns null data from successful REST response", async () => {
    mockFetch(true, 200, {
      data: null,
      meta: { timestamp: "2025-01-01T00:00:00Z" },
    });
    const result = await run(
      restCallEffect("http://localhost", { method: "GET", path: "/v1/test" }),
    );
    expect(result).toBeNull();
  });

  it("sends correct GET request", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              data: "ok",
              meta: { timestamp: "2025-01-01T00:00:00Z" },
            }),
          ),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await run(
      restCallEffect("http://localhost:9999", {
        method: "GET",
        path: "/v1/test",
        query: { key: "value" },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/test?key=value"),
      { method: "GET" },
    );
  });

  it("sends correct POST request with body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              data: "ok",
              meta: { timestamp: "2025-01-01T00:00:00Z" },
            }),
          ),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await run(
      restCallEffect("http://localhost:9999", {
        method: "POST",
        path: "/v1/submit",
        body: { tx: "deadbeef" },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/submit"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"tx"'),
      }),
    );
  });

  it("throws RestTimeoutError on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    try {
      await run(
        restCallEffect("http://localhost", {
          method: "GET",
          path: "/v1/slow",
          timeoutMs: 50,
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RestTimeoutError);
      if (e instanceof RestTimeoutError) {
        expect(e.path).toBe("/v1/slow");
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
      run(
        restCallEffect("http://localhost", {
          method: "GET",
          path: "/v1/test",
        }),
      ),
    ).rejects.toThrow();
  });

  it("throws on malformed JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve("not json"),
        }),
      ),
    );

    await expect(
      run(
        restCallEffect("http://localhost", {
          method: "GET",
          path: "/v1/test",
        }),
      ),
    ).rejects.toThrow();
  });

  it("throws typed error on REST error response", async () => {
    mockFetch(false, 400, {
      error: { code: "INVALID_REQUEST", message: "Bad request" },
      meta: { timestamp: "2025-01-01T00:00:00Z" },
    });

    await expect(
      run(
        restCallEffect("http://localhost", {
          method: "GET",
          path: "/v1/test",
        }),
      ),
    ).rejects.toThrow();
  });

  it("wraps unknown error code in RestError", async () => {
    mockFetch(false, 418, {
      error: { code: "TEAPOT", message: "I'm a teapot" },
      meta: { timestamp: "2025-01-01T00:00:00Z" },
    });

    try {
      await run(
        restCallEffect("http://localhost", {
          method: "GET",
          path: "/v1/test",
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RestError);
    }
  });
});
