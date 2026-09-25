// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import {
  INDEX_ERROR_BODY_LIMIT_BYTES,
  INDEX_LOOKUP_BODY_LIMIT_BYTES,
  IndexHttpError,
  createIndexHttpClient,
  type FetchLike,
} from "../src/internal/index-http.js";
import type { SignNetwork } from "../src/types.js";
interface SettlementRecord {
  readonly sha256: string;
  readonly tx_id: string;
  readonly signer: string;
  readonly nonce: number;
  readonly network: SignNetwork;
  readonly claim_data_hex?: string;
  readonly metadata_sig?: string;
  readonly signature_scope?: string;
}

function record(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    sha256: "11".repeat(32),
    tx_id: "22".repeat(32),
    signer: "33".repeat(32),
    nonce: 7,
    network: "fast:testnet",
    claim_data_hex: "aa",
    metadata_sig: "44".repeat(64),
    signature_scope: "versioned_transaction",
    ...overrides,
  };
}

function exactBody(value: SettlementRecord = record()): string {
  return JSON.stringify({
    sha256: value.sha256,
    settlements: [
      {
        tx_id: value.tx_id,
        signer: value.signer,
        nonce: value.nonce,
        network: value.network,
        settled_at: "2026-09-14T00:00:00Z",
        claim_data_hex: value.claim_data_hex,
        metadata_sig: value.metadata_sig,
        signature_scope: value.signature_scope,
      },
    ],
  });
}

describe("index HTTP client", () => {
  it.each(["record", "fetchExact"] as const)("freezes constructed network binding for %s", async (method) => {
    const fetchImpl = vi.fn(async () => method === "record"
      ? new Response(null, { status: 200 }) : new Response(exactBody()));
    const options = { network: "fast:testnet" as "fast:testnet" | "fast:mainnet", indexOrigin: "https://index.example", fetchImpl };
    const client = createIndexHttpClient(options);
    options.network = "fast:mainnet";
    expect(client.network).toBe("fast:testnet");
    await expect(client[method](record({ network: "fast:mainnet" }))).rejects.toThrow(/configured network/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await client[method](record());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    {}, [], null,
    { tx_id: "22".repeat(32) },
    { tx_id: "invalid", signer: "33".repeat(32), network: "fast:testnet", settled_at: "time" },
    { tx_id: "22".repeat(32), signer: 7, network: "fast:testnet", settled_at: "time" },
    { tx_id: "22".repeat(32), signer: "33".repeat(32), network: "fast:devnet", settled_at: "time" },
    { tx_id: "22".repeat(32), signer: "33".repeat(32), network: "fast:testnet", settled_at: null },
    { ...JSON.parse(exactBody()).settlements[0], nonce: Number.MAX_SAFE_INTEGER + 1 },
    { ...JSON.parse(exactBody()).settlements[0], metadata_sig: [] },
    { ...JSON.parse(exactBody()).settlements[0], list_by_signer: "false" },
  ].map((row) => [row] as const))("rejects a malformed individual public settlement row: %j", async (row) => {
    const client = createIndexHttpClient({
      network: "fast:testnet", indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(JSON.stringify({ sha256: record().sha256, settlements: [row] })),
    });
    await expect(client.fetchExact(record())).rejects.toMatchObject({
      kind: "terminal", message: "index /by-hash returned a malformed settlement row",
    });
  });
  it("POSTs exactly the five current fields and accepts exact 200 without parsing a body", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response("not-json", { status: 200 }));
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example/",
      fetchImpl,
    });

    await expect(client.record(record())).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://index.example/record");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      sha256: "11".repeat(32),
      tx_id: "22".repeat(32),
      signer: "33".repeat(32),
      nonce: 7,
      network: "fast:testnet",
    });
  });

  it("serializes the same record snapshot that passed the configured-network check", async () => {
    let networkReads = 0;
    const input = {
      ...record(),
      get network() {
        networkReads += 1;
        return networkReads === 1 ? "fast:testnet" as const : "fast:mainnet" as const;
      },
    };
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }));
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl,
    });

    await client.record(input);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).network).toBe("fast:testnet");
    expect(networkReads).toBe(1);
  });

  it("cancels an accepted record response body", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ignored"));
      },
      cancel() {
        canceled = true;
      },
    });
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(body, { status: 200 }),
    });

    await expect(client.record(record())).resolves.toBeUndefined();
    expect(canceled).toBe(true);
  });

  it.each([201, 202, 204])("rejects non-200 record acknowledgements: %i", async (status) => {
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(null, { status }),
    });

    await expect(client.record(record())).rejects.toMatchObject({
      kind: "terminal",
      status,
    });
  });

  it("rejects redirect following for both record delivery and exact lookup", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      if (init?.redirect !== "error") throw new Error("redirect policy was not fail-closed");
      return init.method === "POST"
        ? new Response(null, { status: 200 })
        : new Response(JSON.stringify({ sha256: record().sha256, settlements: [] }));
    });
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl,
    });

    await expect(client.record(record())).resolves.toBeUndefined();
    await expect(client.fetchExact(record())).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("error");
    expect(fetchImpl.mock.calls[1]?.[1]?.redirect).toBe("error");
  });

  it.each([
    [408, "retryable"],
    [429, "retryable"],
    [503, "retryable"],
    [409, "conflict"],
    [400, "terminal"],
  ] as const)("classifies HTTP %i as %s and bounds the diagnostic body", async (status, kind) => {
    const body = "x".repeat(INDEX_ERROR_BODY_LIMIT_BYTES + 100);
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () =>
        new Response(body, { status, headers: { "retry-after": status === 429 ? "31" : "" } }),
    });

    try {
      await client.record(record());
    } catch (error) {
      expect(error).toBeInstanceOf(IndexHttpError);
      expect((error as IndexHttpError).kind).toBe(kind);
      expect((error as IndexHttpError).status).toBe(status);
      expect(((error as IndexHttpError).body ?? "").length).toBeLessThanOrEqual(504);
      if (status === 429) expect((error as IndexHttpError).retryAfterMs).toBe(31_000);
      return;
    }
    throw new Error(`HTTP ${status} unexpectedly succeeded`);
  });

  it("classifies transport failures without leaking a richer record", async () => {
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(client.record(record())).rejects.toMatchObject({ kind: "transport" });
  });

  it("uses the post-body response-time clock for a direct exact GET HTTP-date retry", async () => {
    let instant = 1_700_000_000_000;
    const now = vi.fn(() => instant);
    const fetchImpl = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Headers have arrived, but reading the body takes long enough to expire the delay.
          instant += 10_000;
          controller.enqueue(new TextEncoder().encode("temporarily unavailable"));
          controller.close();
        },
      }, { highWaterMark: 0 });
      return new Response(body, {
        status: 503,
        headers: { "retry-after": new Date(1_700_000_005_000).toUTCString() },
      });
    });
    const client = createIndexHttpClient({ network: "fast:testnet", indexOrigin: "https://index.example", fetchImpl, now });

    await expect(client.fetchExact(record())).rejects.toMatchObject({
      kind: "retryable",
      status: 503,
      retryAfterMs: 0,
    });
    expect(now).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves retry classification if the response-time clock fails", async () => {
    let requested = false;
    const now = vi.fn(() => {
      if (requested) throw new Error("clock unavailable after lookup");
      return 1_700_000_000_000;
    });
    const fetchImpl = vi.fn(async () => {
      requested = true;
      return new Response("temporarily unavailable", {
        status: 503,
        headers: { "retry-after": new Date(1_700_000_005_000).toUTCString() },
      });
    });
    const client = createIndexHttpClient({ network: "fast:testnet", indexOrigin: "https://index.example", fetchImpl, now });

    await expect(client.fetchExact(record())).rejects.toMatchObject({
      kind: "retryable",
      status: 503,
      retryAfterMs: undefined,
    });
    expect(now).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid direct exact-lookup clock before any GET", async () => {
    const fetchImpl = vi.fn();
    const client = createIndexHttpClient({
      network: "fast:testnet", indexOrigin: "https://index.example", fetchImpl,
      now: () => Number.NaN,
    });

    await expect(client.fetchExact(record())).rejects.toThrow(/clock must return non-negative integer milliseconds/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates destination and network binding before any fetch", async () => {
    const fetchImpl = vi.fn();
    expect(() =>
      createIndexHttpClient({
        network: "fast:devnet" as "fast:testnet",
        indexOrigin: "https://index.example",
        fetchImpl,
      }),
    ).toThrow(/network/i);
    for (const indexOrigin of [
      "https://index.example/path?unexpected=1",
      "https://index.example?",
      "https://index.example#",
    ]) {
      expect(() =>
        createIndexHttpClient({
          network: "fast:testnet",
          indexOrigin,
          fetchImpl,
        }),
      ).toThrow(/origin/i);
    }
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl,
    });
    await expect(client.record(record({ network: "fast:mainnet" }))).rejects.toThrow(/network/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("performs an exact bounded lookup and rejects duplicate, malformed, or truncated rows", async () => {
    const responses = [
      new Response(exactBody()),
      new Response(JSON.stringify({ sha256: record().sha256, settlements: [{}, {}] })),
      new Response("not-json"),
      new Response(
        JSON.stringify({ sha256: record().sha256, settlements: [] }) +
          " ".repeat(INDEX_LOOKUP_BODY_LIMIT_BYTES),
      ),
    ];
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => responses.shift()!,
    });

    await expect(client.fetchExact(record())).resolves.toMatchObject({
      sha256: record().sha256,
      tx_id: record().tx_id,
      signer: record().signer,
      nonce: 7,
    });
    await expect(client.fetchExact(record())).rejects.toMatchObject({ kind: "terminal" });
    await expect(client.fetchExact(record())).rejects.toMatchObject({ kind: "terminal" });
    await expect(client.fetchExact(record())).rejects.toMatchObject({ kind: "terminal" });
  });

  it("classifies an exact-lookup response stream failure as transport", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"sha256":"'));
        controller.error(new Error("connection reset while reading index response"));
      },
    });
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(body),
    });

    await expect(client.fetchExact(record())).rejects.toMatchObject({
      kind: "transport",
      message: expect.stringMatching(/connection reset/i),
    });
  });

  it("rejects a settlement row whose optional hash contradicts the document hash", async () => {
    const value = record();
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(JSON.stringify({
        sha256: value.sha256,
        settlements: [{
          tx_id: value.tx_id,
          signer: value.signer,
          nonce: value.nonce,
          network: value.network,
          settled_at: "2026-09-14T00:00:00Z",
          sha256: "44".repeat(32),
        }],
      })),
    });

    await expect(client.fetchExact(value)).rejects.toMatchObject({
      kind: "terminal",
      message: expect.stringMatching(/contradictory.*hash/i),
    });
  });

  it("accepts an optional settlement row hash when it matches the document hash", async () => {
    const value = record();
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(JSON.stringify({
        sha256: value.sha256.toUpperCase(),
        settlements: [{
          tx_id: value.tx_id,
          signer: value.signer,
          nonce: value.nonce,
          network: value.network,
          settled_at: "2026-09-14T00:00:00Z",
          sha256: value.sha256.toUpperCase(),
        }],
      })),
    });

    await expect(client.fetchExact(value)).resolves.toMatchObject({ sha256: value.sha256 });
  });

  it.each([
    ["transaction", { tx_id: "44".repeat(32) }],
    ["network", { network: "fast:mainnet" }],
  ] as const)("rejects an exact lookup row for a different %s", async (_label, mismatch) => {
    const value = record();
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      fetchImpl: async () => new Response(JSON.stringify({
        sha256: value.sha256,
        settlements: [{
          tx_id: value.tx_id,
          signer: value.signer,
          nonce: value.nonce,
          network: value.network,
          settled_at: "2026-09-14T00:00:00Z",
          ...mismatch,
        }],
      })),
    });

    await expect(client.fetchExact(value)).rejects.toMatchObject({
      kind: "terminal",
      message: expect.stringMatching(/different transaction or network/i),
    });
  });

  it("keeps the deadline active while an error response stream never terminates", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      },
    });
    const client = createIndexHttpClient({
      network: "fast:testnet",
      indexOrigin: "https://index.example",
      deadlineMs: 25,
      fetchImpl: async () => new Response(body, { status: 503 }),
    });

    await expect(client.record(record())).rejects.toMatchObject({
      kind: "retryable",
      message: expect.stringMatching(/timed out/i),
    });
  });
});
