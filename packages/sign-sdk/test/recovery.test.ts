// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vitest";

import { recoverSettlement, registerReceipt, verifyReceipt } from "../src/recovery.js";
import type { RecoveryJournal, SubmissionUnknownJournalSnapshot } from "../src/types.js";

it("keeps an unobserved submission indeterminate without signing or submitting", async () => {
  const snapshot: SubmissionUnknownJournalSnapshot = {
    version: 1,
    state: "submission_unknown",
    operationId: "recover-op",
    updatedAt: 1,
    operation: {
      input: { operationId: "recover-op", sha256: "11".repeat(32), relationship: "authored", listBySigner: false },
      network: "fast:testnet",
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      senderHex: "22".repeat(32),
      nonce: "7",
      requestIdHex: "33".repeat(16),
      issuedAtNanoseconds: "1",
      fee: null,
    },
    submission: {
      txId: "44".repeat(32),
      signingBytesHex: "aa",
      transactionBytesHex: "bb",
      senderSignatureHex: "55".repeat(64),
      claimDataHex: "cc",
    },
  };
  const save = vi.fn();
  const journal: RecoveryJournal = {
    load: vi.fn(async () => snapshot),
    save,
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };
  const getCertificate = vi.fn(async () => null);

  await expect(recoverSettlement({
    operationId: snapshot.operationId,
    journal,
    reader: { origin: snapshot.operation.proxyUrl, getCertificate },
  })).resolves.toEqual({
    settlement: "unknown",
    operationId: snapshot.operationId,
    txId: snapshot.submission.txId,
    recoveryPersisted: true,
  });
  expect(getCertificate).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it("reports a stable validation error for a malformed reader origin", async () => {
  const journal: RecoveryJournal = {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };

  await expect(recoverSettlement({
    operationId: "recover-op",
    journal,
    reader: { origin: "not an absolute URL", getCertificate: vi.fn(async () => null) },
  })).rejects.toThrow("reader.origin must be a configured public HTTP(S) proxy URL");
});

it("snapshots receipt identity once before journal lookup", async () => {
  let operationIdReads = 0;
  let recordReads = 0;
  const recordFieldReads = { sha256: 0, tx_id: 0, signer: 0, nonce: 0, network: 0 };
  const record = {
    get sha256() { recordFieldReads.sha256 += 1; return "11".repeat(32); },
    get tx_id() { recordFieldReads.tx_id += 1; return "22".repeat(32); },
    get signer() { recordFieldReads.signer += 1; return "33".repeat(32); },
    get nonce() { recordFieldReads.nonce += 1; return 7; },
    get network() { recordFieldReads.network += 1; return "fast:testnet" as const; },
  };
  const receipt = {
    version: 1 as const,
    get operationId() {
      operationIdReads += 1;
      return operationIdReads === 1 ? "safe-operation" : "../unsafe-operation";
    },
    indexOrigin: "https://index.example",
    get record() {
      recordReads += 1;
      return record;
    },
    claimDataHex: "01",
    senderSignatureHex: "44".repeat(64),
    signatureScope: "versioned_transaction" as const,
    certificate: "{}",
  };
  const journal: RecoveryJournal = {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };

  await expect(registerReceipt({
    receipt,
    network: "fast:testnet",
    indexOrigin: "https://index.example",
    journal,
    reader: { origin: "https://proxy.example", getCertificate: vi.fn(async () => null) },
  })).rejects.toThrow();

  expect(operationIdReads).toBe(1);
  expect(recordReads).toBe(1);
  expect(recordFieldReads).toEqual({ sha256: 1, tx_id: 1, signer: 1, nonce: 1, network: 1 });
  expect(journal.load).toHaveBeenCalledTimes(1);
  expect(journal.load).toHaveBeenCalledWith("safe-operation");
  expect(journal.withLock).not.toHaveBeenCalled();
  expect(journal.save).not.toHaveBeenCalled();
});

it("bounds an object certificate before cloning it into a public receipt", async () => {
  const certificate: Record<string, unknown> = {};
  let current = certificate;
  for (let depth = 0; depth < 130; depth += 1) {
    const next: Record<string, unknown> = {};
    current.nested = next;
    current = next;
  }
  current.uncloneable = () => undefined;

  await expect(verifyReceipt({
    network: "fast:testnet",
    receipt: {
      version: 1,
      operationId: "bounded-receipt",
      indexOrigin: "https://index.example",
      record: {
        sha256: "11".repeat(32),
        tx_id: "22".repeat(32),
        signer: "33".repeat(32),
        nonce: 7,
        network: "fast:testnet",
      },
      claimDataHex: "01",
      senderSignatureHex: "44".repeat(64),
      signatureScope: "versioned_transaction",
      certificate,
    },
    reader: { origin: "https://proxy.example", getCertificate: vi.fn(async () => null) },
  })).rejects.toMatchObject({ code: "certificate_too_large" });
});

it("validates and uses one bounded certificate snapshot when a nested getter changes its next value", async () => {
  let reads = 0;
  const certificate = {
    get extra() {
      reads += 1;
      return reads === 1 ? "small" : "x".repeat(2 * 1024 * 1024);
    },
  };

  await expect(verifyReceipt({
    network: "fast:testnet",
    receipt: {
      version: 1,
      operationId: "bounded-getter-receipt",
      indexOrigin: "https://index.example",
      record: {
        sha256: "11".repeat(32),
        tx_id: "22".repeat(32),
        signer: "33".repeat(32),
        nonce: 7,
        network: "fast:testnet",
      },
      claimDataHex: "01",
      senderSignatureHex: "44".repeat(64),
      signatureScope: "versioned_transaction",
      certificate,
    },
    reader: { origin: "https://proxy.example", getCertificate: vi.fn(async () => null) },
  })).rejects.toMatchObject({ code: "invalid_certificate" });

  expect(reads).toBe(1);
});
