import { describe, expect, it, vi } from "vitest";

import { HttpError, IdReader, InvalidReadResponseError, isCanonicalName } from "../src/index.js";

const ALICE_ADDRESS = "fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolved(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "https://id.fast.xyz/alice.smith",
    network: "fast:mainnet",
    address: ALICE_ADDRESS,
    name: "alice.smith",
    name_claim_tx: "ab".repeat(32),
    verified_properties: [],
    signed_content_status: "available",
    signed_content: [],
    imported_works: [],
    note: "",
    ...overrides,
  };
}

describe("IdReader", () => {
  it("resolves a name without a signer, against the network's ID origin", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return json(resolved());
    });
    const reader = new IdReader({ network: "fast:mainnet", fetchImpl: fetchImpl as typeof fetch });

    const id = await reader.resolve("alice.smith");

    expect(id.address).toBe(ALICE_ADDRESS);
    expect(id.name).toBe("alice.smith");
    expect(calls).toEqual(["https://id.fast.xyz/alice.smith/id.json"]);
  });

  it("fails closed when the document belongs to another network", async () => {
    const reader = new IdReader({
      network: "fast:mainnet",
      fetchImpl: (async () => json(resolved({ network: "fast:testnet" }))) as typeof fetch,
    });

    await expect(reader.resolve("alice.smith")).rejects.toBeInstanceOf(InvalidReadResponseError);
  });

  it("fails closed when the document is bound to a different name", async () => {
    const reader = new IdReader({
      network: "fast:mainnet",
      fetchImpl: (async () => json(resolved({ id: "https://id.fast.xyz/mallory.x", name: "mallory.x" }))) as typeof fetch,
    });

    await expect(reader.resolve("alice.smith")).rejects.toBeInstanceOf(InvalidReadResponseError);
  });

  it("surfaces an unregistered name as an HTTP 404", async () => {
    const reader = new IdReader({
      network: "fast:mainnet",
      fetchImpl: (async () => json({ error: "not found" }, 404)) as typeof fetch,
    });

    const error = await reader.resolve("nobody.here").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it("rejects unknown networks", () => {
    expect(() => new IdReader({ network: "fast:devnet" as never })).toThrow(/Unknown network/);
  });
});

describe("isCanonicalName", () => {
  it("accepts two lowercase labels and rejects everything else", () => {
    expect(isCanonicalName("alice.smith")).toBe(true);
    expect(isCanonicalName("agent_1.fast")).toBe(true);
    expect(isCanonicalName("alice")).toBe(false);
    expect(isCanonicalName("Alice.Smith")).toBe(false);
    expect(isCanonicalName("a.b.c")).toBe(false);
    expect(isCanonicalName("api.smith")).toBe(false);
    expect(isCanonicalName(ALICE_ADDRESS)).toBe(false);
  });
});
