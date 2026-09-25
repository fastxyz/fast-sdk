// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vitest";

import { createRecordClient } from "../src/record-client.js";
import type { JournalSnapshot, RecoveryJournal, SettledJournalSnapshot } from "../src/types.js";

const receipt = {
  version: 1 as const,
  operationId: "record-op",
  indexOrigin: "https://index.example",
  record: {
    sha256: "11".repeat(32),
    tx_id: "22".repeat(32),
    signer: "33".repeat(32),
    nonce: 7,
    network: "fast:testnet" as const,
  },
  claimDataHex: "aa",
  senderSignatureHex: "44".repeat(64),
  signatureScope: "versioned_transaction" as const,
  certificate: "fixture-certificate",
};

function settled(): SettledJournalSnapshot {
  return {
    version: 1,
    state: "registration_pending",
    operationId: receipt.operationId,
    updatedAt: 1,
    operation: {
      input: { operationId: receipt.operationId, sha256: receipt.record.sha256, relationship: "authored", listBySigner: false },
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: receipt.indexOrigin,
      senderHex: receipt.record.signer,
      nonce: "7",
      requestIdHex: "55".repeat(16),
      issuedAtNanoseconds: "1",
      fee: null,
    },
    submission: {
      txId: receipt.record.tx_id,
      signingBytesHex: "aa",
      transactionBytesHex: "bb",
      senderSignatureHex: receipt.senderSignatureHex,
      claimDataHex: receipt.claimDataHex,
    },
    receipt,
  };
}

function memoryJournal(initial: JournalSnapshot): RecoveryJournal & { saves: JournalSnapshot[] } {
  let value = structuredClone(initial);
  const saves: JournalSnapshot[] = [];
  return {
    saves,
    load: vi.fn(async () => structuredClone(value)),
    save: vi.fn(async (next) => { value = structuredClone(next); saves.push(structuredClone(next)); }),
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };
}

it("checkRegistration performs exact GET only", async () => {
  const journal = memoryJournal(settled());
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBeUndefined();
    return new Response(JSON.stringify({ sha256: receipt.record.sha256, settlements: [] }));
  });
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });
  await expect(client.checkRegistration(receipt)).resolves.toMatchObject({ registration: "pending" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("matches durable records independently of object key insertion order", async () => {
  const initial = settled();
  const journal = memoryJournal({
    ...initial,
    receipt: {
      ...initial.receipt,
      record: {
        network: initial.receipt.record.network,
        nonce: initial.receipt.record.nonce,
        signer: initial.receipt.record.signer,
        tx_id: initial.receipt.record.tx_id,
        sha256: initial.receipt.record.sha256,
      },
    },
  });
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sha256: receipt.record.sha256, settlements: [] })));
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });

  await expect(client.checkRegistration(receipt)).resolves.toMatchObject({
    registration: "pending",
    receipt: { record: receipt.record },
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("retryRegistration performs one explicit POST and persists acknowledgement", async () => {
  const journal = memoryJournal(settled());
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    return new Response(null, { status: 200 });
  });
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });
  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({ registration: "registered" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(journal.saves.at(-1)).toMatchObject({ state: "registered" });
});

it("captures the registration timestamp before a successful POST", async () => {
  const journal = memoryJournal(settled());
  let posted = false;
  const now = vi.fn(() => {
    if (posted) throw new Error("clock unavailable after registration");
    return 123;
  });
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    posted = true;
    return new Response(null, { status: 200 });
  });
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl, now });

  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({ registration: "registered", recoveryPersisted: true });
  expect(now).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(journal.saves.at(-1)).toMatchObject({ state: "registered", updatedAt: 123 });
});

it("uses the pre-request timestamp for an HTTP-date retry response", async () => {
  const journal = memoryJournal(settled());
  let posted = false;
  const now = vi.fn(() => {
    if (posted) throw new Error("clock unavailable after registration");
    return 1_700_000_000_000;
  });
  const fetchImpl = vi.fn(async () => {
    posted = true;
    return new Response("temporarily unavailable", {
      status: 503,
      headers: { "retry-after": new Date(1_700_000_005_000).toUTCString() },
    });
  });
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl, now });

  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({
    registration: "pending",
    recoveryPersisted: true,
    error: expect.stringMatching(/503|temporarily unavailable/i),
  });
  expect(now).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("reads the configured clock capability once and uses it for journal persistence", async () => {
  const journal = memoryJournal(settled());
  let clockReads = 0;
  const client = createRecordClient({
    network: "fast:testnet",
    indexOrigin: receipt.indexOrigin,
    journal,
    fetchImpl: vi.fn(async () => new Response(null, { status: 200 })),
    get now() {
      clockReads += 1;
      if (clockReads !== 1) throw new Error("clock getter was read again");
      return () => 123;
    },
  });

  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({ registration: "registered" });
  expect(clockReads).toBe(1);
  expect(journal.saves.at(-1)).toMatchObject({ state: "registered", updatedAt: 123 });
});

it("uses the captured clock to calculate HTTP-date Retry-After", async () => {
  const journal = memoryJournal(settled());
  const now = vi.fn()
    .mockReturnValueOnce(1_700_000_000_000)
    .mockReturnValueOnce(1_700_000_001_000);
  const retryAt = 1_700_000_005_000;
  let clockReads = 0;
  const client = createRecordClient({
    network: "fast:testnet",
    indexOrigin: receipt.indexOrigin,
    journal,
    fetchImpl: vi.fn(async () => new Response("temporarily unavailable", {
      status: 503,
      headers: { "retry-after": new Date(retryAt).toUTCString() },
    })),
    get now() {
      clockReads += 1;
      if (clockReads !== 1) throw new Error("clock getter was read again");
      return now;
    },
  });

  await expect(client.checkRegistration(receipt)).rejects.toMatchObject({
    kind: "retryable",
    status: 503,
    retryAfterMs: 4_000,
  });
  expect(clockReads).toBe(1);
  expect(now).toHaveBeenCalledTimes(2);
});

it("persists a pending diagnostic when conflict reconciliation fails", async () => {
  const journal = memoryJournal(settled());
  const responses = [
    new Response("already exists", { status: 409 }),
    new Response("not-json", { status: 200 }),
  ];
  const fetchImpl = vi.fn(async () => responses.shift()!);
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });

  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({
    registration: "pending",
    recoveryPersisted: true,
    error: expect.stringMatching(/malformed JSON/i),
  });
  expect(journal.saves.at(-1)).toMatchObject({
    state: "registration_pending",
    diagnostic: { code: "registration_pending" },
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("preserves a persisted conflict when its reconciliation is inconclusive", async () => {
  const journal = memoryJournal({
    ...settled(),
    state: "registration_conflict",
    diagnostic: { code: "registration_conflict", message: "previous conflict", at: 1 },
  });
  const responses = [
    new Response("already exists", { status: 409 }),
    new Response("not-json", { status: 200 }),
  ];
  const fetchImpl = vi.fn(async () => responses.shift()!);
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });

  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({
    registration: "conflict",
    recoveryPersisted: true,
    error: expect.stringMatching(/malformed JSON/i),
  });
  expect(journal.saves.at(-1)).toMatchObject({
    state: "registration_conflict",
    diagnostic: { code: "registration_conflict" },
  });
});

it("preserves a persisted conflict when retry receives an inconclusive 503", async () => {
  const journal = memoryJournal({
    ...settled(),
    state: "registration_conflict",
    diagnostic: { code: "registration_conflict", message: "previous conflict", at: 1 },
  });
  const fetchImpl = vi.fn(async () => new Response("temporarily unavailable", { status: 503 }));
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });

  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({
    registration: "conflict",
    recoveryPersisted: true,
    error: expect.stringMatching(/503|temporarily unavailable/i),
  });
  expect(journal.saves.at(-1)).toMatchObject({
    state: "registration_conflict",
    diagnostic: { code: "registration_conflict" },
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("rejects a receipt whose indexOrigin is not the exact configured origin", async () => {
  const journal = memoryJournal(settled());
  const client = createRecordClient({
    network: "fast:testnet",
    indexOrigin: receipt.indexOrigin,
    journal,
    fetchImpl: vi.fn(),
  });

  await expect(client.checkRegistration({
    ...receipt,
    indexOrigin: "https://index.example/hidden-path?same-origin=1",
  })).rejects.toThrow(/index.?origin/i);
});

it("uses the network binding captured when the record client was constructed", async () => {
  const journal = memoryJournal(settled());
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sha256: receipt.record.sha256, settlements: [] })));
  const options = {
    network: "fast:testnet" as "fast:testnet" | "fast:mainnet",
    indexOrigin: receipt.indexOrigin,
    journal,
    fetchImpl,
  };
  const client = createRecordClient(options);
  options.network = "fast:mainnet";

  await expect(client.checkRegistration(receipt)).resolves.toMatchObject({ registration: "pending" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("validates and uses one bounded receipt snapshot when a getter changes its next value", async () => {
  const journal = memoryJournal(settled());
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sha256: receipt.record.sha256, settlements: [] })));
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });
  const source = { ...receipt } as typeof receipt;
  let reads = 0;
  Object.defineProperty(source, "operationId", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? receipt.operationId : "x".repeat(2 * 1024 * 1024);
    },
  });

  await expect(client.checkRegistration(source)).resolves.toMatchObject({ registration: "pending" });
  expect(reads).toBe(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("persists the detached journal identity when the source mutates its loaded value during I/O", async () => {
  const source = structuredClone(settled());
  const saved: JournalSnapshot[] = [];
  let startFetch!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { startFetch = resolve; });
  let finishFetch!: (response: Response) => void;
  const fetchResponse = new Promise<Response>((resolve) => { finishFetch = resolve; });
  const journal: RecoveryJournal = {
    load: vi.fn(async () => source),
    save: vi.fn(async (snapshot) => { saved.push(structuredClone(snapshot)); }),
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };
  const fetchImpl = vi.fn(async () => {
    startFetch();
    return fetchResponse;
  });
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });
  const check = client.checkRegistration(receipt);

  await fetchStarted;
  (source.operation as { nonce: string }).nonce = "99";
  (source.submission as { txId: string }).txId = "aa".repeat(32);
  (source.receipt.record as { tx_id: string }).tx_id = "bb".repeat(32);
  finishFetch(new Response(JSON.stringify({ sha256: receipt.record.sha256, settlements: [] })));

  await expect(check).resolves.toMatchObject({ registration: "pending" });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    operation: { nonce: "7" },
    submission: { txId: receipt.record.tx_id },
    receipt: { record: { tx_id: receipt.record.tx_id } },
  });
});
