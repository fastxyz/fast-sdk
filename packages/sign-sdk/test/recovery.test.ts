// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vitest";

import { recoverSettlement } from "../src/recovery.js";
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
