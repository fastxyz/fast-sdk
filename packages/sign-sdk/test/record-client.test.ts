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

it("retryRegistration performs one explicit POST and persists acknowledgement", async () => {
  const journal = memoryJournal(settled());
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    return new Response(null, { status: 204 });
  });
  const client = createRecordClient({ network: "fast:testnet", indexOrigin: receipt.indexOrigin, journal, fetchImpl });
  await expect(client.retryRegistration(receipt)).resolves.toMatchObject({ registration: "registered" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(journal.saves.at(-1)).toMatchObject({ state: "registered" });
});
