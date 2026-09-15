import { describe, expect, it, vi } from "vitest";

import {
  HttpError,
  InvalidReadResponseError,
  ReadCancelledError,
  ReadTimeoutError,
} from "../src/index.js";
import { HttpClient } from "../src/http.js";
import { IdReads } from "../src/reads.js";

const ALICE_ADDRESS =
  "fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv";
const BOB_ADDRESS =
  "fast13289h54tze49fhr4g7x4zee5t95ah7xpq9e727yy3lpme4dll6zshexh9v";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolved(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "https://testnet.id.fast.xyz/alice.smith",
    network: "fast:testnet",
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

describe("public identity reads", () => {
  it("uses the documented public paths and returns parsed documents", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/alice.smith/id.json")) {
        return json({
          id: "https://testnet.id.fast.xyz/alice.smith",
          network: "fast:testnet",
          address: ALICE_ADDRESS,
          name: "alice.smith",
          name_claim_tx: "ab".repeat(32),
          verified_properties: [],
          signed_content_status: "available",
          signed_content: [],
          imported_works: [],
          note: "",
        });
      }
      if (url.endsWith(`/${ALICE_ADDRESS}/identity.json`)) {
        return json({
          network: "fast:testnet",
          address: ALICE_ADDRESS,
          name: "alice.smith",
          name_claim_tx: "ab".repeat(32),
        });
      }
      if (url.includes("/api/availability?")) {
        return json({
          network: "fast:testnet",
          available: true,
          taken: false,
          skeleton_conflict: false,
          reserved: false,
        });
      }
      if (url.endsWith(`/api/links/${ALICE_ADDRESS}`)) {
        return json({ address: ALICE_ADDRESS, network: "fast:testnet", links: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", fetchImpl as typeof fetch),
      "fast:testnet",
    );

    expect(await reads.resolve("alice.smith")).toMatchObject({ address: ALICE_ADDRESS });
    expect(await reads.identity(ALICE_ADDRESS)).toMatchObject({ name: "alice.smith" });
    expect(await reads.availability("alice.smith")).toEqual({
      network: "fast:testnet",
      available: true,
      taken: false,
      skeleton_conflict: false,
      reserved: false,
    });
    expect(await reads.links(ALICE_ADDRESS)).toMatchObject({ links: [] });
    expect(calls).toEqual([
      "https://testnet.id.fast.xyz/alice.smith/id.json",
      `https://testnet.id.fast.xyz/${ALICE_ADDRESS}/identity.json`,
      "https://testnet.id.fast.xyz/api/availability?name=alice.smith",
      `https://testnet.id.fast.xyz/api/links/${ALICE_ADDRESS}`,
    ]);
  });

  it.each([
    ["resolve", "valid JSON string", (reads: IdReads) => reads.resolve("alice.smith")],
    ["identity", [], (reads: IdReads) => reads.identity(ALICE_ADDRESS)],
    [
      "availability",
      {
        network: "fast:testnet",
        available: true,
        taken: false,
        skeleton_conflict: false,
      },
      (reads: IdReads) => reads.availability("alice.smith"),
    ],
    [
      "links",
      {
        address: ALICE_ADDRESS,
        network: "fast:testnet",
        links: [{ kind: "website", value: "example.com", status: "trusted" }],
      },
      (reads: IdReads) => reads.links(ALICE_ADDRESS),
    ],
  ])("rejects malformed successful %s responses at runtime", async (endpoint, body, read) => {
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => json(body)),
      "fast:testnet",
    );

    await expect(read(reads)).rejects.toMatchObject({
      name: "InvalidReadResponseError",
      endpoint,
    } satisfies Partial<InvalidReadResponseError>);
  });

  it.each([
    [
      "resolver address",
      resolved({ address: "fast1alice" }),
      "resolve",
      (reads: IdReads) => reads.resolve("alice.smith"),
    ],
    [
      "resolver name without claim transaction",
      resolved({ name_claim_tx: undefined }),
      "resolve",
      (reads: IdReads) => reads.resolve("alice.smith"),
    ],
    [
      "resolver claim transaction without name",
      resolved({
        id: `https://testnet.id.fast.xyz/${ALICE_ADDRESS}`,
        name: undefined,
      }),
      "resolve",
      (reads: IdReads) => reads.resolve(ALICE_ADDRESS),
    ],
    [
      "compact address",
      { network: "fast:testnet", address: "fast1alice" },
      "identity",
      (reads: IdReads) => reads.identity("fast1alice"),
    ],
    [
      "compact name",
      {
        network: "fast:testnet",
        address: ALICE_ADDRESS,
        name: "Not Canonical",
        name_claim_tx: "ab".repeat(32),
      },
      "identity",
      (reads: IdReads) => reads.identity(ALICE_ADDRESS),
    ],
  ])("rejects a noncanonical %s document", async (_case, body, endpoint, read) => {
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => json(body)),
      "fast:testnet",
    );

    await expect(read(reads)).rejects.toMatchObject({
      name: "InvalidReadResponseError",
      endpoint,
    } satisfies Partial<InvalidReadResponseError>);
  });

  it("accepts a same-network legacy availability snapshot without taken", async () => {
    const body = {
      network: "fast:testnet",
      available: true,
      skeleton_conflict: false,
      reserved: false,
    };
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => json(body)),
      "fast:testnet",
    );

    await expect(reads.availability("alice.smith")).resolves.toEqual(body);
  });

  it.each([
    [
      "resolve identity",
      resolved({
        id: "https://testnet.id.fast.xyz/bob.smith",
        address: BOB_ADDRESS,
        name: "bob.smith",
      }),
      "resolve",
      (reads: IdReads) => reads.resolve("alice.smith"),
    ],
    [
      "resolve network",
      resolved({
        id: "https://id.fast.xyz/alice.smith",
        network: "fast:mainnet",
      }),
      "resolve",
      (reads: IdReads) => reads.resolve("alice.smith"),
    ],
    [
      "resolve canonical id",
      resolved({ id: "https://other.example/alice.smith" }),
      "resolve",
      (reads: IdReads) => reads.resolve("alice.smith"),
    ],
    [
      "identity address",
      {
        network: "fast:testnet",
        address: BOB_ADDRESS,
        name: "bob.smith",
        name_claim_tx: "cd".repeat(32),
      },
      "identity",
      (reads: IdReads) => reads.identity(ALICE_ADDRESS),
    ],
    [
      "identity network",
      {
        network: "fast:mainnet",
        address: ALICE_ADDRESS,
        name: "alice.smith",
        name_claim_tx: "ab".repeat(32),
      },
      "identity",
      (reads: IdReads) => reads.identity(ALICE_ADDRESS),
    ],
    [
      "availability network",
      {
        network: "fast:mainnet",
        available: true,
        taken: false,
        skeleton_conflict: false,
        reserved: false,
      },
      "availability",
      (reads: IdReads) => reads.availability("alice.smith"),
    ],
    [
      "links address",
      { network: "fast:testnet", address: BOB_ADDRESS, links: [] },
      "links",
      (reads: IdReads) => reads.links(ALICE_ADDRESS),
    ],
    [
      "links network",
      { network: "fast:mainnet", address: ALICE_ADDRESS, links: [] },
      "links",
      (reads: IdReads) => reads.links(ALICE_ADDRESS),
    ],
  ])("rejects a shape-valid %s mismatch", async (_case, body, endpoint, read) => {
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => json(body)),
      "fast:testnet",
    );

    await expect(read(reads)).rejects.toMatchObject({
      name: "InvalidReadResponseError",
      endpoint,
    } satisfies Partial<InvalidReadResponseError>);
  });

  it("binds the canonical resolver id to a normalized testnet origin override", async () => {
    const answers = [
      json(resolved({ id: "http://127.0.0.1:3000/alice.smith" })),
      json(resolved()),
    ];
    const reads = new IdReads(
      new HttpClient("http://127.0.0.1:3000/", async () => answers.shift()!),
      "fast:testnet",
    );

    await expect(reads.resolve("alice.smith")).resolves.toMatchObject({
      id: "http://127.0.0.1:3000/alice.smith",
    });
    await expect(reads.resolve("alice.smith")).rejects.toBeInstanceOf(
      InvalidReadResponseError,
    );
  });

  it("rejects an empty successful resolver response instead of returning null", async () => {
    const reads = new IdReads(
      new HttpClient(
        "https://testnet.id.fast.xyz",
        async () => new Response("", { status: 200 }),
      ),
      "fast:testnet",
    );

    await expect(reads.resolve("alice.smith")).rejects.toBeInstanceOf(
      InvalidReadResponseError,
    );
  });

  it("keeps invalid JSON distinct from a parsed shape-invalid JSON string", async () => {
    const reads = new IdReads(
      new HttpClient(
        "https://testnet.id.fast.xyz",
        async () => new Response("not JSON", { status: 200 }),
      ),
      "fast:testnet",
    );

    await expect(reads.resolve("alice.smith")).rejects.toMatchObject({
      name: "HttpError",
      status: 200,
      body: "not JSON",
    } satisfies Partial<HttpError>);
  });

  it("marks only claimed:true as load-bearing", async () => {
    const answers = [json({ claimed: false }), json({ claimed: true })];
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => answers.shift()!);
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", fetchImpl as typeof fetch),
      "fast:testnet",
    );

    expect(await reads.propertyClaimed("website", "example.com")).toEqual({
      claimed: false,
      loadBearing: false,
    });
    expect(await reads.propertyClaimed("website", "example.com")).toEqual({
      claimed: true,
      loadBearing: true,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://testnet.id.fast.xyz/api/property/claimed?kind=website&value=example.com",
    );
  });

  it("fails open for an unreachable property check but throws typed HTTP errors elsewhere", async () => {
    const unreachable = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => {
        throw new Error("offline");
      }),
      "fast:testnet",
    );
    expect(await unreachable.propertyClaimed("work", "10.1/example")).toEqual({
      claimed: false,
      loadBearing: false,
    });

    const malformed = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () =>
        json({ claimed: "false" }),
      ),
      "fast:testnet",
    );
    expect(await malformed.propertyClaimed("work", "10.1/example")).toEqual({
      claimed: false,
      loadBearing: false,
    });

    const failed = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => json({ reason: "no" }, 404)),
      "fast:testnet",
    );
    await expect(failed.resolve("alice.smith")).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
      body: { reason: "no" },
    } satisfies Partial<HttpError>);
  });

  it("bounds and cancels availability reads", async () => {
    const calls: RequestInit[] = [];
    const reads = new IdReads(
      new HttpClient(
        "https://testnet.id.fast.xyz",
        ((_input: string | URL | Request, init?: RequestInit) => {
          calls.push(init ?? {});
          return new Promise<Response>(() => {});
        }) as typeof fetch,
      ),
      "fast:testnet",
    );

    await expect(reads.availability("alice.smith", { timeoutMs: 5 })).rejects.toBeInstanceOf(
      ReadTimeoutError,
    );
    expect(calls[0]?.signal?.aborted).toBe(true);

    await expect(
      reads.availability("alice.smith", { timeoutMs: Number.MAX_SAFE_INTEGER }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    await expect(
      reads.availability("alice.smith", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ReadCancelledError);
    expect(calls).toHaveLength(1);
  });

  it("maps a fetch AbortError to the typed timeout and cancellation errors", async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", fetchImpl as typeof fetch),
      "fast:testnet",
    );

    await expect(reads.availability("alice.smith", { timeoutMs: 5 })).rejects.toBeInstanceOf(
      ReadTimeoutError,
    );

    const controller = new AbortController();
    const cancelled = reads.availability("alice.smith", {
      timeoutMs: 100,
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(ReadCancelledError);
  });

  it("does not lose cancellation between the precheck and listener registration", async () => {
    const controller = new AbortController();
    const nativeAdd = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (type, listener, options) => {
        controller.abort();
        nativeAdd(type, listener, options);
      },
    );
    const reads = new IdReads(
      new HttpClient(
        "https://testnet.id.fast.xyz",
        (() => new Promise<Response>(() => {})) as typeof fetch,
      ),
      "fast:testnet",
    );

    await expect(
      reads.availability("alice.smith", { timeoutMs: 5, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ReadCancelledError);
  });

  it("removes the availability listener from the originally captured signal", async () => {
    const original = new AbortController();
    const replacement = new AbortController();
    const originalRemove = vi.spyOn(original.signal, "removeEventListener");
    const replacementRemove = vi.spyOn(replacement.signal, "removeEventListener");
    const options = { timeoutMs: 100, signal: original.signal };
    const reads = new IdReads(
      new HttpClient("https://testnet.id.fast.xyz", async () => {
        options.signal = replacement.signal;
        return json({
          network: "fast:testnet",
          available: true,
          taken: false,
          skeleton_conflict: false,
          reserved: false,
        });
      }),
      "fast:testnet",
    );

    await expect(reads.availability("alice.smith", options)).resolves.toMatchObject({
      available: true,
    });
    expect(originalRemove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(replacementRemove).not.toHaveBeenCalled();
  });
});
