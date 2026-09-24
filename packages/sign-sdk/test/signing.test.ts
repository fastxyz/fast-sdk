// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { FastProvider, Signer } from "@fastxyz/sdk";
import { describe, expect, it, vi } from "vitest";

import type { ByteSigner } from "../src/types.js";
import { decodeAttestationV3 } from "../src/internal/attestation.js";
import { bytesToHex, hexToBytes } from "../src/internal/bytes.js";
import {
  FeePolicyError,
  InsufficientFundsError,
  NonceConflictError,
  SignerMismatchError,
  asNonceConflict,
} from "../src/errors.js";
import {
  assertFeePolicy,
  assertFeeSnapshotUnchanged,
  createProxyFeeSource,
  feeKey,
  resolveClaimFee,
  type FeeSource,
} from "../src/internal/fees.js";
import {
  createFastSdkProviderAdapter,
  deriveTransactionEvidence,
  nonceToSafeNumber,
  prepareExternalClaimTransaction,
  signPreparedTransaction,
} from "../src/internal/transactions.js";
import { createSignClient } from "../src/sign-client.js";
import type { JournalSnapshot } from "../src/recovery.js";

interface ProtocolFixture {
  certificate: {
    signerHex: string;
    senderAddress: string;
    claimDataHex: string;
    signingBytesHex: string;
    senderSignatureHex: string;
    txId: string;
    nonce: number;
    timestampNanos: string;
  };
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/protocol.json", import.meta.url), "utf8"),
) as ProtocolFixture;
const seed = new Uint8Array(32).fill(7);
const tokenId = "44".repeat(32);

function feeSource(options: {
  amount?: string;
  network?: string;
  malformed?: boolean;
  throws?: boolean;
} = {}): FeeSource {
  return {
    async networkInfo() {
      if (options.throws) throw new Error("offline");
      if (options.malformed) return { data: { network_id: "fast:testnet", fees: "bad" } };
      return {
        data: {
          network_id: options.network ?? "fast:testnet",
          fees: {
            default: tokenId,
            entries: [{ token_id: tokenId, fixed_amount: options.amount ?? "7" }],
          },
        },
      };
    },
    async tokenMeta(requested) {
      return {
        data: {
          requested_token_metadata: [
            [requested, { token_name: "testUSDC", decimals: 6, update_id: 2 }],
          ],
        },
      };
    },
  };
}

describe("fee resolution and explicit authorization", () => {
  it.each(["networkInfo", "tokenMeta"] as const)("bounds default %s response bytes before JSON parsing", async (method) => {
    const source = createProxyFeeSource({
      proxyUrl: "https://proxy.example/proxy",
      fetchImpl: async () => new Response(JSON.stringify({ padding: "x".repeat(256 * 1024) })),
    });
    await expect(method === "networkInfo" ? source.networkInfo() : source.tokenMeta(tokenId))
      .rejects.toThrow(/fee response exceeded.*bytes/);
  });

  it.each([
    ["networkInfo", false], ["networkInfo", true],
    ["tokenMeta", false], ["tokenMeta", true],
  ] as const)("deadlines default %s with stalled body=%s", async (method, stalledBody) => {
      let observedSignal: AbortSignal | null | undefined;
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const options = {
        proxyUrl: "https://proxy.example/proxy", deadlineMs: 20,
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          observedSignal = init?.signal;
          if (!stalledBody) return new Promise<Response>(() => {});
          return new Response(new ReadableStream<Uint8Array>({ start(value) {
            controller = value;
            value.enqueue(new TextEncoder().encode("{"));
          } }));
        },
      };
      const source = createProxyFeeSource(options);
      try {
        const guard = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Error("test witness elapsed without fee deadline")), 200);
        });
        await expect(Promise.race([method === "networkInfo" ? source.networkInfo() : source.tokenMeta(tokenId), guard]))
          .rejects.toThrow(/fee request timed out/);
        expect(observedSignal?.aborted).toBe(true);
      } finally {
        if (timer) clearTimeout(timer);
        try { controller?.close(); } catch { /* The aborted reader may have canceled it. */ }
      }
  });
  it("requires fail-closed redirects for both configured fee reads", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.redirect !== "error") throw new Error("redirect policy was not fail-closed");
      return new Response("{}", { status: 200 });
    });
    const source = createProxyFeeSource({ proxyUrl: "https://proxy.example/proxy", fetchImpl });

    await expect(source.networkInfo()).resolves.toEqual({});
    await expect(source.tokenMeta(tokenId)).resolves.toEqual({});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === "error")).toBe(true);
  });

  it("does not treat malformed JSON from the built-in fee endpoint as fee-free", async () => {
    const source = createProxyFeeSource({
      proxyUrl: "https://proxy.example/proxy",
      fetchImpl: async () => new Response("{not valid json", { status: 200 }),
    });

    await expect(resolveClaimFee("fast:testnet", source, true)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("does not treat an oversized received fee body as fee-free", async () => {
    const source = createProxyFeeSource({
      proxyUrl: "https://proxy.example/proxy",
      fetchImpl: async () => new Response("x".repeat(256 * 1024 + 1), { status: 200 }),
    });

    await expect(resolveClaimFee("fast:testnet", source, true)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("rejects readable non-empty default with no fee entries even on configured fee-free networks", async () => {
    for (const feeFreeNetwork of [false, true]) {
      await expect(resolveClaimFee("fast:testnet", {
        networkInfo: async () => ({ data: { network_id: "fast:testnet", fees: { default: tokenId, entries: [] } } }),
        tokenMeta: async () => null,
      }, feeFreeNetwork)).resolves.toEqual({ kind: "unavailable" });
    }
  });

  it.each(["false", 1, null])("rejects malformed fee-free opt-in %j before source reads", async (flag) => {
    const networkInfo = vi.fn(async () => { throw Error("unreadable fixture"); });
    await expect(resolveClaimFee("fast:testnet", { networkInfo, tokenMeta: async () => null }, flag as unknown as boolean))
      .rejects.toThrow(/boolean/);
    expect(networkInfo).not.toHaveBeenCalled();
  });

  it("preserves the narrow fee-free exception and fails closed for readable invalid schedules", async () => {
    await expect(resolveClaimFee("fast:testnet", feeSource({ throws: true }))).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(
      resolveClaimFee("fast:testnet", feeSource({ throws: true }), true),
    ).resolves.toEqual({ kind: "none" });
    await expect(
      resolveClaimFee("fast:testnet", feeSource({ malformed: true }), true),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      resolveClaimFee("fast:testnet", feeSource({ network: "fast:mainnet" }), true),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("reads the authoritative schedule and token metadata from the configured REST gateway", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/network-info")) {
        return new Response(JSON.stringify(await feeSource().networkInfo()), { status: 200 });
      }
      return new Response(JSON.stringify(await feeSource().tokenMeta(tokenId)), { status: 200 });
    });
    const source = createProxyFeeSource({
      proxyUrl: "https://proxy.example/proxy",
      fetchImpl,
    });

    await expect(resolveClaimFee("fast:testnet", source)).resolves.toMatchObject({
      kind: "quoted",
      tokenId,
    });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://proxy.example/proxy-rest/v1/network-info",
      `https://proxy.example/proxy-rest/v1/tokens?token_ids=${tokenId}`,
    ]);
  });

  it("binds positive fees to the exact token and accepted atomic ceiling", async () => {
    const quoted = await resolveClaimFee("fast:testnet", feeSource());
    expect(quoted).toMatchObject({ kind: "quoted", tokenId, atomicAmount: "7" });
    expect(
      assertFeePolicy("fast:testnet", quoted, { tokenId, maxAtomicAmount: "7" }),
    ).toMatchObject({ tokenId, amountAtomic: "7", scheduleFingerprint: feeKey("fast:testnet", quoted) });
    expect(() =>
      assertFeePolicy("fast:testnet", quoted, { tokenId, maxAtomicAmount: "6" }),
    ).toThrow(FeePolicyError);
    expect(() =>
      assertFeePolicy("fast:testnet", quoted, {
        tokenId: "55".repeat(32),
        maxAtomicAmount: "7",
      }),
    ).toThrow(FeePolicyError);
    expect(() =>
      assertFeePolicy(
        "fast:testnet",
        { kind: "unavailable" },
        { tokenId: null, maxAtomicAmount: "0" },
      ),
    ).toThrow(FeePolicyError);
    expect(() =>
      assertFeePolicy("fast:testnet", { kind: "none" }, { tokenId, maxAtomicAmount: "7" }),
    ).toThrow(FeePolicyError);
    expect(
      assertFeePolicy("fast:testnet", { kind: "none" }, { tokenId: null, maxAtomicAmount: "0" }),
    ).toMatchObject({ tokenId: null, amountAtomic: "0" });
  });

  it("invalidates local authorization when an observed schedule changes", async () => {
    const first = await resolveClaimFee("fast:testnet", feeSource({ amount: "7" }));
    const second = await resolveClaimFee("fast:testnet", feeSource({ amount: "8" }));
    if (first.kind === "unavailable" || second.kind === "unavailable") {
      throw new Error("fixture fee unexpectedly unavailable");
    }
    expect(() => assertFeeSnapshotUnchanged("fast:testnet", first, second)).toThrow(FeePolicyError);
    expect(() => assertFeeSnapshotUnchanged("fast:testnet", first, first)).not.toThrow();
  });
});

describe("canonical Fast transaction preparation and caller-owned signing", () => {
  it.each([
    { relationship: "endorsed" },
    { listBySigner: "false" },
    { listBySigner: null },
    { signerName: 42 },
    { signerName: "\ud800" },
    { signerName: "é".repeat(129) },
    { listBySigner: true, publicTitle: "   " },
  ])("rejects malformed SignInput %j before read-only or write capabilities", async (invalid) => {
    const poison = vi.fn(async () => { throw new Error("capability reached"); });
    const client = createSignClient({ network: "fast:testnet", proxyUrl: "https://proxy.example", indexOrigin: "https://index.example",
      signer: { getPublicKey: poison, signMessage: poison }, journal: { load: poison, save: poison, withLock: poison },
      provider: { getNextNonce: poison, submitTransaction: poison }, feeSource: { networkInfo: poison, tokenMeta: poison }, feePolicy: { tokenId: null, maxAtomicAmount: "0" } });
    await expect(client.signDigest({ operationId: "preflight-input", sha256: "11".repeat(32), relationship: "authored", ...invalid } as Parameters<typeof client.signDigest>[0])).rejects.toThrow();
    expect(poison).not.toHaveBeenCalled();
  });

  it("snapshots every raw SignInput property once before validation or durable effects", async () => {
    const original = {
      operationId: "accessor-snapshot",
      sha256: "11".repeat(32),
      relationship: "authored" as const,
      signerName: "Original signer",
      publicTitle: "Original title",
      listBySigner: true,
    };
    const changed = {
      operationId: "changed-operation",
      sha256: "22".repeat(32),
      relationship: "approved" as const,
      signerName: "Changed signer",
      publicTitle: "Changed title",
      listBySigner: false,
    };
    const reads: Record<keyof typeof original, number> = {
      operationId: 0,
      sha256: 0,
      relationship: 0,
      signerName: 0,
      publicTitle: 0,
      listBySigner: 0,
    };
    const rawInput: Record<string, unknown> = {};
    for (const key of Object.keys(original) as (keyof typeof original)[]) {
      Object.defineProperty(rawInput, key, {
        enumerable: true,
        get() {
          reads[key] += 1;
          return reads[key] === 1 ? original[key] : changed[key];
        },
      });
    }

    const actual = new Signer(seed);
    const snapshots: JournalSnapshot[] = [];
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) {
          const snapshot = snapshots.at(-1);
          return snapshot?.operationId === operationId ? structuredClone(snapshot) : null;
        },
        async save(value) { snapshots.push(structuredClone(value)); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction: async () => null },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest(rawInput as unknown as Parameters<typeof client.signDigest>[0]))
      .resolves.toMatchObject({ settlement: "unknown" });

    expect(reads).toEqual({
      operationId: 1,
      sha256: 1,
      relationship: 1,
      signerName: 1,
      publicTitle: 1,
      listBySigner: 1,
    });
    const snapshot = snapshots.at(-1);
    expect(snapshot).toMatchObject({
      state: "submission_unknown",
      operationId: original.operationId,
      operation: {
        input: {
          operationId: original.operationId,
          sha256: original.sha256,
          relationship: original.relationship,
          signerName: original.signerName,
          publicTitle: original.publicTitle,
          listBySigner: original.listBySigner,
        },
      },
    });
    if (snapshot?.state !== "submission_unknown") throw new Error("expected an unknown-submission snapshot");
    const attestation = decodeAttestationV3(hexToBytes(snapshot.submission.claimDataHex));
    expect(bytesToHex(attestation.digest)).toBe(original.sha256);
    expect(attestation.relationship).toBe(original.relationship);
    expect(attestation.signerName).toBe(original.signerName);
    expect(attestation.fileLabel).toBe(original.publicTitle);
    expect(attestation.listBySigner).toBe(original.listBySigner);
  });

  it("serializes concurrent signDigest calls for one operation before submitting", async () => {
    const snapshots = new Map<string, JournalSnapshot>();
    const locks = new Map<string, Promise<void>>();
    const journal = {
      async load(operationId: string) {
        const snapshot = snapshots.get(operationId);
        return snapshot === undefined ? null : structuredClone(snapshot);
      },
      async save(value: JournalSnapshot) {
        snapshots.set(value.operationId, structuredClone(value));
      },
      async withLock<T>(key: string, operation: () => Promise<T>) {
        const previous = locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => { release = resolve; });
        locks.set(key, current);
        await previous;
        try {
          return await operation();
        } finally {
          release();
          if (locks.get(key) === current) locks.delete(key);
        }
      },
    };
    const submitTransaction = vi.fn(async () => null);
    let nextNonce = 7n;
    let activeNonceReads = 0;
    let maxActiveNonceReads = 0;
    const getNextNonce = vi.fn(async () => {
      activeNonceReads += 1;
      maxActiveNonceReads = Math.max(maxActiveNonceReads, activeNonceReads);
      await Promise.resolve();
      activeNonceReads -= 1;
      return nextNonce++;
    });
    const actual = new Signer(seed);
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal,
      provider: { getNextNonce, submitTransaction },
      feeSource: {
        networkInfo: async () => ({ data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }),
        tokenMeta: async () => { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });
    const input = { operationId: "concurrent-operation", sha256: "11".repeat(32), relationship: "authored" as const };

    await expect(Promise.all([client.signDigest(input), client.signDigest(input)])).resolves.toEqual([
      { settlement: "unknown", operationId: input.operationId, txId: expect.any(String), recoveryPersisted: true },
      { settlement: "unknown", operationId: input.operationId, txId: expect.any(String), recoveryPersisted: true },
    ]);
    expect(submitTransaction).toHaveBeenCalledTimes(1);

    const secondInput = (operationId: string) => ({
      operationId,
      sha256: "22".repeat(32),
      relationship: "approved" as const,
    });
    await expect(Promise.all([
      client.signDigest(secondInput("concurrent-first")),
      client.signDigest(secondInput("concurrent-second")),
    ])).resolves.toHaveLength(2);
    expect(getNextNonce).toHaveBeenCalledTimes(3);
    expect(submitTransaction).toHaveBeenCalledTimes(3);
    expect(maxActiveNonceReads).toBe(1);
  });

  it("blocks a different operation after an indeterminate submission reserves its nonce", async () => {
    const snapshots = new Map<string, unknown>();
    const locks = new Map<string, Promise<void>>();
    const journal = {
      async load(operationId: string) {
        const snapshot = snapshots.get(operationId);
        return snapshot === undefined ? null : structuredClone(snapshot) as JournalSnapshot;
      },
      async save(value: JournalSnapshot) {
        snapshots.set(value.operationId, structuredClone(value));
      },
      async withLock<T>(key: string, operation: () => Promise<T>) {
        const previous = locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => { release = resolve; });
        locks.set(key, current);
        await previous;
        try {
          return await operation();
        } finally {
          release();
          if (locks.get(key) === current) locks.delete(key);
        }
      },
    };
    const actual = new Signer(seed);
    const signMessage = vi.fn(async (bytes: Uint8Array) => actual.signMessage(bytes));
    const submitTransaction = vi.fn(async () => null);
    const getNextNonce = vi.fn(async () => 7n);
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage },
      journal,
      provider: { getNextNonce, submitTransaction },
      feeSource: {
        networkInfo: async () => ({ data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }),
        tokenMeta: async () => { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "reserved-first",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "unknown", txId: expect.any(String) });

    const reservation = [...snapshots.values()].find((value) =>
      typeof value === "object" && value !== null && "reservation" in value,
    ) as { state?: unknown; reservation?: { ownerOperationId?: unknown; nonce?: unknown } } | undefined;
    expect(reservation).toMatchObject({
      state: "prepared",
      reservation: { ownerOperationId: "reserved-first", nonce: "7" },
    });

    await expect(client.signDigest({
      operationId: "reserved-second",
      sha256: "22".repeat(32),
      relationship: "approved",
    })).rejects.toThrow(/nonce.*reserved|indeterminate/i);
    expect(snapshots.has("reserved-second")).toBe(false);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(getNextNonce).toHaveBeenCalledTimes(2);
  });

  it("does not persist a nonce reservation when signing fails before submission", async () => {
    const actual = new Signer(seed);
    const snapshots = new Map<string, JournalSnapshot>();
    const signMessage = vi.fn(async () => { throw new Error("signing blocked"); });
    const submitTransaction = vi.fn(async () => null);
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage },
      journal: {
        async load(operationId) { return structuredClone(snapshots.get(operationId) ?? null); },
        async save(value) { snapshots.set(value.operationId, structuredClone(value)); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "signing-fails-before-submit",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).rejects.toThrow("signing blocked");
    expect([...snapshots.values()].some((snapshot) => "reservation" in snapshot && snapshot.reservation !== undefined)).toBe(false);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("releases a new nonce reservation when submission evidence cannot be persisted", async () => {
    const actual = new Signer(seed);
    const snapshots = new Map<string, JournalSnapshot>();
    const submitTransaction = vi.fn(async () => null);
    let failEvidenceSave = true;
    let failClockAfterEvidenceWrite = false;
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) { return structuredClone(snapshots.get(operationId) ?? null); },
        async save(value) {
          if (failEvidenceSave && value.state === "submission_unknown") {
            failEvidenceSave = false;
            failClockAfterEvidenceWrite = true;
            throw new Error("journal evidence write failed");
          }
          snapshots.set(value.operationId, structuredClone(value));
        },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => {
        if (failClockAfterEvidenceWrite) throw new Error("clock unavailable");
        return 1_700_000_000_000;
      },
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "evidence-write-fails",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).rejects.toThrow("journal evidence write failed");
    const reservation = [...snapshots.values()].find((snapshot) => snapshot.operationId.startsWith("nonce-reservation-"));
    expect(reservation).toMatchObject({ state: "prepared" });
    expect(reservation && "reservation" in reservation ? reservation.reservation : undefined).toBeUndefined();
    expect(submitTransaction).not.toHaveBeenCalled();
    failClockAfterEvidenceWrite = false;

    // A retry must replace the release tombstone with a fresh durable
    // reservation before it can submit. The pre-submit path must also reuse
    // the already validated instant rather than reading a failing clock.
    await expect(client.signDigest({
      operationId: "evidence-write-fails",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "unknown", operationId: "evidence-write-fails" });
    const retriedReservation = [...snapshots.values()].find((snapshot) => snapshot.operationId.startsWith("nonce-reservation-"));
    expect(retriedReservation).toMatchObject({
      state: "prepared",
      reservation: { ownerOperationId: "evidence-write-fails", nonce: "7" },
    });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("retains the nonce reservation when the retry marker cannot be persisted", async () => {
    const actual = new Signer(seed);
    const snapshots = new Map<string, JournalSnapshot>();
    const submitTransaction = vi.fn(async () => null);
    let failEvidenceSave = true;
    let failRetryMarkerSave = true;
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) { return structuredClone(snapshots.get(operationId) ?? null); },
        async save(value) {
          if (failEvidenceSave && value.state === "submission_unknown") {
            failEvidenceSave = false;
            throw new Error("journal evidence write failed");
          }
          if (failRetryMarkerSave && value.state === "prepared" && value.diagnostic !== undefined) {
            failRetryMarkerSave = false;
            throw new Error("journal retry marker write failed");
          }
          snapshots.set(value.operationId, structuredClone(value));
        },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "retry-marker-write-fails",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).rejects.toThrow("journal evidence write failed");
    const reservation = [...snapshots.values()].find((snapshot) => snapshot.operationId.startsWith("nonce-reservation-"));
    expect(reservation).toMatchObject({
      state: "prepared",
      reservation: { ownerOperationId: "retry-marker-write-fails", nonce: "7" },
    });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("releases a partially persisted reservation when its write fails", async () => {
    const actual = new Signer(seed);
    const snapshots = new Map<string, JournalSnapshot>();
    const submitTransaction = vi.fn(async () => null);
    let failReservationSave = true;
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) { return structuredClone(snapshots.get(operationId) ?? null); },
        async save(value) {
          if (failReservationSave && value.operationId.startsWith("nonce-reservation-") && "reservation" in value && value.reservation !== undefined) {
            failReservationSave = false;
            snapshots.set(value.operationId, structuredClone(value));
            throw new Error("nonce reservation write failed");
          }
          snapshots.set(value.operationId, structuredClone(value));
        },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "reservation-write-fails",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).rejects.toThrow("nonce reservation write failed");
    const reservation = [...snapshots.values()].find((snapshot) => snapshot.operationId.startsWith("nonce-reservation-"));
    expect(reservation).toMatchObject({ state: "prepared" });
    expect(reservation && "reservation" in reservation ? reservation.reservation : undefined).toBeUndefined();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("turns submit-result extraction traps into durable unknown settlement", async () => {
    const actual = new Signer(seed);
    const snapshotState: { snapshot: JournalSnapshot | null } = { snapshot: null };
    const submitTransaction = vi.fn(async () => new Proxy({}, {
      has() { throw new Error("malformed submit result"); },
    }));
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) {
          return snapshotState.snapshot?.operationId === operationId ? structuredClone(snapshotState.snapshot) : null;
        },
        async save(value) { snapshotState.snapshot = structuredClone(value); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "submit-result-trap",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "unknown", recoveryPersisted: true, txId: expect.any(String) });
    expect(snapshotState.snapshot).toMatchObject({ state: "submission_unknown" });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("settles and registers a successful signed envelope exactly once", async () => {
    const actual = new Signer(seed);
    const snapshots: JournalSnapshot[] = [];
    const submitTransaction = vi.fn(async (envelope: unknown) => ({
      envelope,
      signatures: [],
    }));
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 200 });
    });
    const journal = {
      async load(operationId: string) {
        const value = [...snapshots].reverse().find((entry) => entry.operationId === operationId) ?? null;
        return structuredClone(value);
      },
      async save(value: JournalSnapshot) {
        snapshots.push(structuredClone(value));
      },
      async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
    };
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal,
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      fetchImpl,
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "successful-registration",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "settled", registration: "registered", recoveryPersisted: true });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toMatchObject({ state: "registered" });
  });

  it("returns a recovery receipt when the clock fails after submission", async () => {
    const actual = new Signer(seed);
    const snapshots: JournalSnapshot[] = [];
    let submitted = false;
    const submitTransaction = vi.fn(async (envelope: unknown) => {
      submitted = true;
      return { envelope, signatures: [] };
    });
    const now = vi.fn(() => {
      if (submitted) throw new Error("clock unavailable after submission");
      return 1_700_000_000_000;
    });
    const journal = {
      async load(operationId: string) {
        const value = [...snapshots].reverse().find((entry) => entry.operationId === operationId) ?? null;
        return structuredClone(value);
      },
      async save(value: JournalSnapshot) {
        if (value.state === "registration_pending") throw new Error("settlement journal write failed");
        snapshots.push(structuredClone(value));
      },
      async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
    };
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal,
      provider: { getNextNonce: async () => 7n, submitTransaction },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      now,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "clock-fails-after-submit",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "settled", registration: "pending", recoveryPersisted: false });
    expect(now).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toMatchObject({ state: "submission_unknown" });
  });

  it("captures the network getter once before validation and assignment", async () => {
    const actual = new Signer(seed);
    const snapshots: JournalSnapshot[] = [];
    let reads = 0;
    const options = {
      get network() {
        reads += 1;
        return reads === 1 ? "fast:testnet" : "fast:mainnet";
      },
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes: Uint8Array) => actual.signMessage(bytes) },
      journal: {
        async load(operationId: string) {
          return structuredClone([...snapshots].reverse().find((entry) => entry.operationId === operationId) ?? null);
        },
        async save(value: JournalSnapshot) { snapshots.push(structuredClone(value)); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction: async () => null },
      feeSource: {
        async networkInfo() { throw new Error("fee schedule unavailable"); },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      feePolicy: { feeFreeNetwork: true, tokenId: null, maxAtomicAmount: "0" },
      now: () => 1_700_000_000_000,
      randomBytes: (length: number) => new Uint8Array(length).fill(0x33),
    };
    const client = createSignClient(options as Parameters<typeof createSignClient>[0]);

    await expect(client.signDigest({
      operationId: "network-getter-snapshot",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "unknown" });
    expect(reads).toBe(1);
    expect(snapshots.find((snapshot) => snapshot.operationId === "network-getter-snapshot"))
      .toMatchObject({ operation: { network: "fast:testnet" } });
  });

  it.each([undefined, null, 7, {}, "", "../escape", "x".repeat(129), "valid\n", `nonce-reservation-${"0".repeat(64)}`])("rejects runtime operationId %j before any capability", async (operationId) => {
    const poison = vi.fn(async () => { throw new Error("capability reached"); });
    const journal = { load: poison, save: poison, withLock: poison };
    const client = createSignClient({
      network: "fast:testnet", proxyUrl: "https://proxy.example", indexOrigin: "https://index.example",
      signer: { getPublicKey: poison, signMessage: poison }, journal,
      provider: { getNextNonce: poison, submitTransaction: poison },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
    });
    await expect(client.signDigest({ operationId: operationId as string, sha256: "11".repeat(32), relationship: "authored" })).rejects.toThrow(/operationId/);
    expect(poison).not.toHaveBeenCalled();
  });

  it("rejects boxed digest before any capability", async () => {
    const poison = vi.fn(async () => { throw new Error("capability reached"); });
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: poison, signMessage: poison },
      journal: { load: poison, save: poison, withLock: poison },
      provider: { getNextNonce: poison, submitTransaction: poison },
      feeSource: { networkInfo: poison, tokenMeta: poison },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
    });
    await expect(client.signDigest({
      operationId: "boxed-digest",
      sha256: new String("11".repeat(32)) as unknown as string,
      relationship: "authored",
    })).rejects.toThrow(/sha256|hex|string/i);
    expect(poison).not.toHaveBeenCalled();
  });

  it("rejects a clock timestamp beyond transaction u64 before nonce, fee, or persistence", async () => {
    const poison = vi.fn(async () => { throw new Error("capability reached"); });
    const snapshotSaves = vi.fn(async () => undefined);
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: async () => new Uint8Array(32), signMessage: poison },
      journal: {
        load: async () => null,
        save: snapshotSaves,
        withLock: async (_key, operation) => operation(),
      },
      provider: { getNextNonce: poison, submitTransaction: poison },
      feeSource: { networkInfo: poison, tokenMeta: poison },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      now: () => Number(((1n << 64n) - 1n) / 1_000_000n) + 1,
    });

    await expect(client.signDigest({
      operationId: "clock-overflow",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).rejects.toThrow(/u64 range/i);
    expect(poison).not.toHaveBeenCalled();
    expect(snapshotSaves).not.toHaveBeenCalled();
  });

  it("captures signer, provider, journal, network, and policy capabilities at construction", async () => {
    const actual = new Signer(seed);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let firstLock = true;
    let snapshot: JournalSnapshot | null = null;
    const journal = {
      async load(operationId: string) {
        return snapshot?.operationId === operationId ? structuredClone(snapshot) : null;
      },
      async save(value: JournalSnapshot) { snapshot = structuredClone(value); },
      async withLock<T>(_key: string, operation: () => Promise<T>) {
        if (firstLock) {
          firstLock = false;
          markStarted();
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return operation();
      },
    };
    const submitTransaction = vi.fn(async () => null);
    const options = {
      network: "fast:testnet" as const,
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes: Uint8Array) => actual.signMessage(bytes) },
      journal,
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: { getNextNonce: vi.fn(async () => 7n), submitTransaction },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length: number) => new Uint8Array(length).fill(0x33),
    };
    const client = createSignClient(options);
    const signing = client.signDigest({
      operationId: "captured-options",
      sha256: "11".repeat(32),
      relationship: "authored",
    });
    await started;
    const poison = vi.fn(async () => { throw new Error("mutated capability used"); });
    Object.assign(options as unknown as Record<string, unknown>, {
      network: "fast:mainnet",
      signer: { getPublicKey: poison, signMessage: poison },
      provider: { getNextNonce: poison, submitTransaction: poison },
      journal: { load: poison, save: poison, withLock: poison },
      feePolicy: { tokenId: "55".repeat(32), maxAtomicAmount: "999" },
    });
    release();

    await expect(signing).resolves.toMatchObject({ settlement: "unknown" });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(poison).not.toHaveBeenCalled();
  });

  it("owns a journal snapshot before later awaits can mutate the journal result", async () => {
    const actual = new Signer(seed);
    const originalTxId = fixture.certificate.txId;
    const snapshot: JournalSnapshot = {
      version: 1,
      state: "submission_unknown",
      operationId: "journal-snapshot-ownership",
      updatedAt: 1,
      operation: {
        input: {
          operationId: "journal-snapshot-ownership",
          sha256: "11".repeat(32),
          relationship: "authored",
          listBySigner: false,
        },
        network: "fast:testnet",
        proxyUrl: "https://proxy.example/proxy",
        indexOrigin: "https://index.example",
        senderHex: fixture.certificate.signerHex,
        nonce: "7",
        requestIdHex: "33".repeat(16),
        issuedAtNanoseconds: fixture.certificate.timestampNanos,
        fee: { tokenId: null, amountAtomic: "0", scheduleFingerprint: "fast:testnet|none" },
      },
      submission: {
        txId: originalTxId,
        signingBytesHex: fixture.certificate.signingBytesHex,
        transactionBytesHex: "01",
        senderSignatureHex: fixture.certificate.senderSignatureHex,
        claimDataHex: fixture.certificate.claimDataHex,
      },
    };
    const getPublicKey = vi.fn(async () => {
      // A valid but hostile journal can retain and mutate the object it returned.
      // The client must have detached its own snapshot before this await resumes.
      (snapshot.submission as unknown as { txId: string }).txId = "11".repeat(32);
      return actual.getPublicKey();
    });
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey, signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load() { return snapshot; },
        async save() { undefined; },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: vi.fn(async () => 7n), submitTransaction: vi.fn(async () => null) },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      feeSource: feeSource({ amount: "0" }),
    });

    await expect(client.signDigest({
      operationId: snapshot.operationId,
      sha256: snapshot.operation.input.sha256,
      relationship: "authored",
    })).resolves.toEqual({ settlement: "unknown", operationId: snapshot.operationId, txId: originalTxId, recoveryPersisted: true });
  });

  it("uses one owned request ID for both the attestation and journal identity", async () => {
    const actual = new Signer(seed);
    const journalState: { snapshot: JournalSnapshot | null } = { snapshot: null };
    const requestId = new Uint8Array(16).fill(0x33);
    const originalIterator = requestId[Symbol.iterator].bind(requestId);
    let iteratorCalls = 0;
    Object.defineProperty(requestId, Symbol.iterator, {
      value() {
        if (iteratorCalls++ === 1) requestId.fill(0x44);
        return originalIterator();
      },
    });
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) {
          const snapshot = journalState.snapshot;
          return snapshot?.operationId === operationId ? structuredClone(snapshot) : null;
        },
        async save(value) { journalState.snapshot = structuredClone(value); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      provider: { getNextNonce: async () => 7n, submitTransaction: async () => null },
      feePolicy: { tokenId, maxAtomicAmount: "7" },
      feeSource: feeSource(),
      now: () => 1_700_000_000_000,
      randomBytes: () => requestId,
    });

    await expect(client.signDigest({
      operationId: "owned-request-id",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "unknown" });
    const snapshot = journalState.snapshot;
    if (snapshot?.state !== "submission_unknown") throw new Error("expected an unknown-submission journal snapshot");

    const attestation = decodeAttestationV3(hexToBytes(snapshot.submission.claimDataHex));
    expect(snapshot.operation.requestIdHex).toBe("33".repeat(16));
    expect(bytesToHex(attestation.requestId)).toBe(snapshot.operation.requestIdHex);
  });

  it.each([
    ["nonce", { _tag: "ProxyUnexpectedNonceError", expectedNonce: 8n }, NonceConflictError],
    ["funding", { details: { InsufficientFundingForFee: {} } }, InsufficientFundsError],
  ] as const)("surfaces a definitive %s submit rejection while retaining the submitted transaction", async (kind, rejection, ErrorType) => {
    const actual = new Signer(seed);
    let snapshot: JournalSnapshot | null = null;
    const submitTransaction = vi.fn(async () => { throw rejection; });
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage: (bytes) => actual.signMessage(bytes) },
      journal: {
        async load(operationId) { return snapshot?.operationId === operationId ? structuredClone(snapshot) : null; },
        async save(value) { snapshot = structuredClone(value); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: { getNextNonce: vi.fn(async () => 7n), submitTransaction },
      feeSource: {
        async networkInfo() { return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } }; },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });
    const input = { operationId: `definitive-${kind}`, sha256: "11".repeat(32), relationship: "authored" as const };

    await expect(client.signDigest(input)).rejects.toBeInstanceOf(ErrorType);
    expect(snapshot).toMatchObject({ state: "submission_unknown" });
    await expect(client.signDigest(input)).resolves.toMatchObject({ settlement: "unknown" });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown", "network", { network: "fast:mainnet" as const }],
    ["unknown", "proxy", { proxyUrl: "https://other-proxy.example/proxy" }],
    ["unknown", "index", { indexOrigin: "https://other-index.example" }],
    ["settled", "network", { network: "fast:mainnet" as const }],
  ] as const)("rejects a resumed %s operation with a different frozen %s before capabilities", async (state, _binding, override) => {
    const unknown: JournalSnapshot = {
      version: 1,
      state: "submission_unknown",
      operationId: "frozen-bindings",
      updatedAt: 1,
      operation: {
        input: {
          operationId: "frozen-bindings",
          sha256: "11".repeat(32),
          relationship: "authored",
          listBySigner: false,
        },
        network: "fast:testnet",
        proxyUrl: "https://proxy.example/proxy",
        indexOrigin: "https://index.example",
        senderHex: fixture.certificate.signerHex,
        nonce: "7",
        requestIdHex: "33".repeat(16),
        issuedAtNanoseconds: fixture.certificate.timestampNanos,
        fee: { tokenId: null, amountAtomic: "0", scheduleFingerprint: "fast:testnet|none" },
      },
      submission: {
        txId: fixture.certificate.txId,
        signingBytesHex: fixture.certificate.signingBytesHex,
        transactionBytesHex: "01",
        senderSignatureHex: fixture.certificate.senderSignatureHex,
        claimDataHex: fixture.certificate.claimDataHex,
      },
    };
    const snapshot: JournalSnapshot = state === "unknown" ? unknown : {
      ...unknown,
      state: "registered",
      receipt: {
        version: 1,
        operationId: unknown.operationId,
        indexOrigin: unknown.operation.indexOrigin,
        record: {
          sha256: unknown.operation.input.sha256,
          tx_id: unknown.submission.txId,
          signer: unknown.operation.senderHex,
          nonce: 7,
          network: unknown.operation.network,
        },
        claimDataHex: unknown.submission.claimDataHex,
        senderSignatureHex: unknown.submission.senderSignatureHex,
        signatureScope: "versioned_transaction",
        certificate: "{}",
      },
    };
    const getPublicKey = vi.fn(async () => new Uint8Array(32));
    const signMessage = vi.fn(async () => new Uint8Array(64));
    const getNextNonce = vi.fn(async () => 8n);
    const submitTransaction = vi.fn(async () => null);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey, signMessage },
      journal: {
        load: async () => structuredClone(snapshot),
        save: async () => undefined,
        withLock: async (_key, operation) => operation(),
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: { getNextNonce, submitTransaction },
      feeSource: feeSource({ amount: "0" }),
      fetchImpl,
      ...override,
    });

    await expect(client.signDigest(snapshot.operation.input)).rejects.toThrow(/configured network|destinations/i);
    expect(getPublicKey).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
    expect(getNextNonce).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "https://proxy.example/proxy?region=one",
    "https://proxy.example/proxy?",
    "https://proxy.example/proxy#",
  ])("rejects a query or fragment-bearing proxy before effects: %s", (proxyUrl) => {
    const getPublicKey = vi.fn(async () => new Uint8Array(32));
    const signMessage = vi.fn(async () => new Uint8Array(64));
    const getNextNonce = vi.fn(async () => 0n);
    const submitTransaction = vi.fn(async () => null);
    const load = vi.fn(async () => null);
    const save = vi.fn(async () => undefined);
    let lockCalls = 0;

    expect(() => createSignClient({
      network: "fast:testnet",
      proxyUrl,
      indexOrigin: "https://index.example",
      signer: { getPublicKey, signMessage },
      journal: {
        load,
        save,
        async withLock<T>(_key: string, operation: () => Promise<T>) {
          lockCalls += 1;
          return operation();
        },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: { getNextNonce, submitTransaction },
      feeSource: feeSource({ amount: "0" }),
    })).toThrow(/proxyUrl/i);
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(lockCalls).toBe(0);
    expect(getPublicKey).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
    expect(getNextNonce).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("does not freeze an ignored publicTitle when signer listing is disabled", async () => {
    const actual = new Signer(seed);
    let snapshot: import("../src/recovery.js").JournalSnapshot | null = null;
    const signMessage = vi.fn((bytes: Uint8Array) => actual.signMessage(bytes));
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer: { getPublicKey: () => actual.getPublicKey(), signMessage },
      journal: {
        async load(operationId) {
          return snapshot?.operationId === operationId ? structuredClone(snapshot) : null;
        },
        async save(value) { snapshot = structuredClone(value); },
        async withLock<T>(_key: string, operation: () => Promise<T>) { return operation(); },
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: {
        getNextNonce: vi.fn(async () => 7n),
        submitTransaction: vi.fn(async () => null),
      },
      feeSource: {
        async networkInfo() {
          return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } };
        },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });
    const common = {
      operationId: "ignored-title",
      sha256: "11".repeat(32),
      relationship: "authored" as const,
      listBySigner: false,
    };

    await expect(client.signDigest({ ...common, publicTitle: "not committed" })).resolves.toMatchObject({
      settlement: "unknown",
    });
    const stored = snapshot as import("../src/recovery.js").JournalSnapshot | null;
    expect(stored?.operation.input).not.toHaveProperty("publicTitle");
    await expect(client.signDigest(common)).resolves.toMatchObject({ settlement: "unknown" });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("owns the signer public-key bytes before later provider and fee awaits", async () => {
    const actual = new Signer(seed);
    const originalPublicKey = await actual.getPublicKey();
    const sharedPublicKey = Uint8Array.from(originalPublicKey);
    let publicKeyCalls = 0;
    const signer: ByteSigner = {
      async getPublicKey() {
        publicKeyCalls += 1;
        return publicKeyCalls === 1 ? sharedPublicKey : Uint8Array.from(originalPublicKey);
      },
      signMessage: (bytes) => actual.signMessage(bytes),
    };
    const submitTransaction = vi.fn(async () => null);
    const client = createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "https://index.example",
      signer,
      journal: {
        load: async () => null,
        save: async () => undefined,
        withLock: async (_key, operation) => operation(),
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: {
        async getNextNonce() {
          sharedPublicKey.fill(0x99);
          return 7n;
        },
        submitTransaction,
      },
      feeSource: {
        async networkInfo() {
          return { data: { network_id: "fast:testnet", fees: { default: "", entries: [] } } };
        },
        async tokenMeta() { throw new Error("fee-free fixture must not read token metadata"); },
      },
      now: () => 1_700_000_000_000,
      randomBytes: (length) => new Uint8Array(length).fill(0x33),
    });

    await expect(client.signDigest({
      operationId: "owned-public-key",
      sha256: "11".repeat(32),
      relationship: "authored",
    })).resolves.toMatchObject({ settlement: "unknown" });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects an unconfigured index before reading nonce or invoking the signer", () => {
    const getPublicKey = vi.fn(async () => new Uint8Array(32));
    const signMessage = vi.fn(async () => new Uint8Array(64));
    const getNextNonce = vi.fn(async () => 0n);
    const submitTransaction = vi.fn(async () => null);

    expect(() => createSignClient({
      network: "fast:testnet",
      proxyUrl: "https://proxy.example/proxy",
      indexOrigin: "",
      signer: { getPublicKey, signMessage },
      journal: {
        load: async () => null,
        save: async () => undefined,
        withLock: async (_key, operation) => operation(),
      },
      feePolicy: { tokenId: null, maxAtomicAmount: "0" },
      provider: { getNextNonce, submitTransaction },
      feeSource: feeSource({ amount: "0" }),
    })).toThrow(/indexOrigin/i);
    expect(getPublicKey).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
    expect(getNextNonce).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("adapts the public FastProvider surface without collapsing nonce read into submit", async () => {
    expect(() =>
      createFastSdkProviderAdapter(
        new FastProvider({ url: "https://proxy.example", networkId: "fast:testnet" }),
      ),
    ).not.toThrow();
    const getAccountInfo = vi.fn(async () => ({ nextNonce: 7n }));
    const submitTransaction = vi.fn(async () => ({ type: "fixture-result" }));
    const adapter = createFastSdkProviderAdapter({ getAccountInfo, submitTransaction });

    await expect(adapter.getNextNonce(fixture.certificate.senderAddress)).resolves.toBe(7n);
    expect(getAccountInfo).toHaveBeenCalledWith({
      address: fixture.certificate.senderAddress,
      tokenBalancesFilter: null,
      stateKeyFilter: null,
    });
    const envelope = { fixture: true };
    await expect(adapter.submitTransaction(envelope)).resolves.toEqual({ type: "fixture-result" });
    expect(submitTransaction).toHaveBeenCalledWith(envelope);
  });

  it("captures the FastProvider source methods and their receiver before caller mutation", async () => {
    const provider = {
      nonce: 7n,
      submitted: [] as unknown[],
      async getAccountInfo() { return { nextNonce: this.nonce }; },
      async submitTransaction(envelope: unknown) { this.submitted.push(envelope); return { accepted: true }; },
    };
    const adapter = createFastSdkProviderAdapter(provider);
    const poison = vi.fn(async () => { throw new Error("mutated source capability used"); });
    provider.getAccountInfo = poison;
    provider.submitTransaction = poison;
    await expect(adapter.getNextNonce(fixture.certificate.senderAddress)).resolves.toBe(7n);
    const envelope = { fixture: true };
    await expect(adapter.submitTransaction(envelope)).resolves.toEqual({ accepted: true });
    expect(provider.submitted).toEqual([envelope]);
    expect(poison).not.toHaveBeenCalled();
  });

  it("matches the independent website signing bytes and Rust-compatible tx-id fixture", async () => {
    const prepared = await prepareExternalClaimTransaction({
      network: "fast:testnet",
      senderPublicKey: Uint8Array.from(Buffer.from(fixture.certificate.signerHex, "hex")),
      nonce: 7n,
      claimDataHex: fixture.certificate.claimDataHex,
      feeToken: null,
      timestampNanos: BigInt(fixture.certificate.timestampNanos),
    });

    expect(prepared.senderAddress).toBe(fixture.certificate.senderAddress);
    expect(Buffer.from(prepared.signingBytes).toString("hex")).toBe(
      fixture.certificate.signingBytesHex,
    );
    expect(prepared.txId).toBe(fixture.certificate.txId);
  });

  it("derives all evidence from an owned transaction snapshot", async () => {
    const prepared = await prepareExternalClaimTransaction({
      network: "fast:testnet",
      senderPublicKey: Uint8Array.from(Buffer.from(fixture.certificate.signerHex, "hex")),
      nonce: 7n,
      claimDataHex: fixture.certificate.claimDataHex,
      feeToken: null,
      timestampNanos: BigInt(fixture.certificate.timestampNanos),
    });
    const versioned = structuredClone(prepared.versioned) as {
      value: { nonce: bigint };
    };
    const pending = deriveTransactionEvidence(versioned);
    versioned.value.nonce = 8n;
    const evidence = await pending;

    expect(evidence.txId).toBe(prepared.txId);
    expect(Buffer.from(evidence.signingBytes).toString("hex")).toBe(
      Buffer.from(prepared.signingBytes).toString("hex"),
    );
    expect(Buffer.from(evidence.transactionBytes).toString("hex")).toBe(
      Buffer.from(prepared.transactionBytes).toString("hex"),
    );
  });

  it("returns prepared scalar evidence from snapshots, not caller mutations", async () => {
    const input = {
      network: "fast:testnet" as const,
      senderPublicKey: new Uint8Array(32).fill(7),
      nonce: 7n,
      claimDataHex: fixture.certificate.claimDataHex,
      feeToken: null,
      timestampNanos: BigInt(fixture.certificate.timestampNanos),
    };
    const pending = prepareExternalClaimTransaction(input);
    input.nonce = 8n;
    input.claimDataHex = "aa";
    input.timestampNanos = 9n;
    const prepared = await pending;

    expect(prepared.nonce).toBe(7n);
    expect(prepared.claimDataHex).toBe(fixture.certificate.claimDataHex);
    expect(prepared.timestampNanos).toBe(BigInt(fixture.certificate.timestampNanos));
  });

  it("uses a public Fast SDK Signer structurally, never reads its private key, and signs once", async () => {
    const actual = new Signer(seed);
    const getPrivateKey = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const signMessage = vi.fn((bytes: Uint8Array) => actual.signMessage(bytes));
    const signer: ByteSigner & { getPrivateKey(): Promise<Uint8Array> } = {
      getPublicKey: () => actual.getPublicKey(),
      signMessage,
      getPrivateKey,
    };
    const prepared = await prepareExternalClaimTransaction({
      network: "fast:testnet",
      senderPublicKey: await actual.getPublicKey(),
      nonce: 7n,
      claimDataHex: fixture.certificate.claimDataHex,
      feeToken: null,
      timestampNanos: BigInt(fixture.certificate.timestampNanos),
    });

    const signed = await signPreparedTransaction(prepared, signer);

    expect(signed.senderSignatureHex).toBe(fixture.certificate.senderSignatureHex);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(getPrivateKey).not.toHaveBeenCalled();
  });

  it("rejects another key before signing and rejects malformed or invalid signatures", async () => {
    const actual = new Signer(seed);
    const prepared = await prepareExternalClaimTransaction({
      network: "fast:testnet",
      senderPublicKey: await actual.getPublicKey(),
      nonce: 7n,
      claimDataHex: fixture.certificate.claimDataHex,
      feeToken: null,
      timestampNanos: BigInt(fixture.certificate.timestampNanos),
    });
    const other = new Signer(new Uint8Array(32).fill(8));
    const otherSign = vi.fn((bytes: Uint8Array) => other.signMessage(bytes));
    await expect(
      signPreparedTransaction(prepared, {
        getPublicKey: () => other.getPublicKey(),
        signMessage: otherSign,
      }),
    ).rejects.toBeInstanceOf(SignerMismatchError);
    expect(otherSign).not.toHaveBeenCalled();

    await expect(
      signPreparedTransaction(prepared, {
        getPublicKey: () => actual.getPublicKey(),
        signMessage: async () => new Uint8Array(63),
      }),
    ).rejects.toThrow(/64-byte/i);
    await expect(
      signPreparedTransaction(prepared, {
        getPublicKey: () => actual.getPublicKey(),
        signMessage: async () => new Uint8Array(64),
      }),
    ).rejects.toThrow(/local verification/i);
  });

  it("detects altered prepared bytes before invoking the signer", async () => {
    const actual = new Signer(seed);
    const prepared = await prepareExternalClaimTransaction({
      network: "fast:testnet",
      senderPublicKey: await actual.getPublicKey(),
      nonce: 7n,
      claimDataHex: fixture.certificate.claimDataHex,
      feeToken: null,
      timestampNanos: BigInt(fixture.certificate.timestampNanos),
    });
    prepared.signingBytes[0] = prepared.signingBytes[0]! ^ 1;
    const signMessage = vi.fn((bytes: Uint8Array) => actual.signMessage(bytes));

    await expect(
      signPreparedTransaction(prepared, {
        getPublicKey: () => actual.getPublicKey(),
        signMessage,
      }),
    ).rejects.toThrow(/prepared transaction.*changed/i);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("rejects unsupported network and unsafe nonce before any signature", async () => {
    const signMessage = vi.fn(async () => new Uint8Array(64));
    await expect(
      prepareExternalClaimTransaction({
        network: "fast:devnet" as "fast:testnet",
        senderPublicKey: new Uint8Array(32),
        nonce: 0n,
        claimDataHex: fixture.certificate.claimDataHex,
        feeToken: null,
        timestampNanos: 1n,
      }),
    ).rejects.toThrow(/network/i);
    await expect(
      prepareExternalClaimTransaction({
        network: "fast:testnet",
        senderPublicKey: new Uint8Array(32),
        nonce: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        claimDataHex: fixture.certificate.claimDataHex,
        feeToken: null,
        timestampNanos: 1n,
      }),
    ).rejects.toThrow(/supported range/i);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("rejects non-string claim data before transaction capabilities are reached", async () => {
    const signMessage = vi.fn(async () => new Uint8Array(64));
    const invalidInputs = [12, [12]] as unknown[];

    for (const claimDataHex of invalidInputs) {
      await expect(
        prepareExternalClaimTransaction({
          network: "fast:testnet",
          senderPublicKey: new Uint8Array(32),
          nonce: 0n,
          claimDataHex: claimDataHex as string,
          feeToken: null,
          timestampNanos: 1n,
        }),
      ).rejects.toThrow(/claimDataHex/i);
    }
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("normalizes nonce conflicts by tag rather than dependency-instance identity", () => {
    const foreign = { _tag: "ProxyUnexpectedNonceError", expectedNonce: 9n };
    expect(asNonceConflict(foreign)).toEqual(
      expect.objectContaining<Partial<NonceConflictError>>({ expectedNonce: 9n }),
    );
    expect(asNonceConflict({ _tag: "SomethingElse" })).toBeNull();
  });

  it("narrows nonce without precision loss", () => {
    expect(nonceToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => nonceToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      /supported range/i,
    );
    expect(() => nonceToSafeNumber(-1n)).toThrow(/supported range/i);
    expect(() => nonceToSafeNumber("7" as unknown as bigint)).toThrow(/bigint/i);
    expect(() => nonceToSafeNumber(1.5 as unknown as bigint)).toThrow(/bigint/i);
  });
});
