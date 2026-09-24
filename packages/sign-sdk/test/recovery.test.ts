// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import { validateSettlementCertificate } from "../src/internal/receipts.js";
import { recoverSettlement, registerReceipt, snapshotRecoveryJournal, verifyReceipt } from "../src/recovery.js";
import type { JournalSnapshot, RecoveryJournal, SubmissionUnknownJournalSnapshot } from "../src/types.js";

const protocol = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/protocol.json"), "utf8"),
).certificate as Record<string, unknown>;

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

it("captures journal capabilities once at construction", async () => {
  const load = vi.fn(async () => null);
  const save = vi.fn(async (_snapshot: JournalSnapshot) => undefined);
  const withLockMock = vi.fn(async <T>(_key: string, operation: () => Promise<T>): Promise<T> => operation());
  const withLock = withLockMock as unknown as RecoveryJournal["withLock"];
  const source: RecoveryJournal = { load, save, withLock };
  const captured = snapshotRecoveryJournal(source);

  source.load = async () => { throw new Error("mutated load used"); };
  source.save = async () => { throw new Error("mutated save used"); };
  source.withLock = async () => { throw new Error("mutated lock used"); };

  await expect(captured.load("capability-snapshot")).resolves.toBeNull();
  await captured.save({} as JournalSnapshot);
  await expect(captured.withLock("capability-snapshot", async () => "ok")).resolves.toBe("ok");
  expect(load).toHaveBeenCalledWith("capability-snapshot");
  expect(save).toHaveBeenCalledTimes(1);
  expect(withLockMock).toHaveBeenCalledTimes(1);
});

it("captures a settlement reader getter once before validation and binding", async () => {
  const expected = vi.fn(async () => null);
  const poison = vi.fn(async () => { throw new Error("mutated reader used"); });
  let reads = 0;
  const reader = {
    origin: "https://proxy.example",
    get getCertificate() {
      reads += 1;
      return reads === 1 ? expected : poison;
    },
  };
  const snapshot: SubmissionUnknownJournalSnapshot = {
    version: 1,
    state: "submission_unknown",
    operationId: "reader-capability-snapshot",
    updatedAt: 1,
    operation: {
      input: { operationId: "reader-capability-snapshot", sha256: "11".repeat(32), relationship: "authored", listBySigner: false },
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
  const journal: RecoveryJournal = {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };

  await expect(recoverSettlement({
    operationId: "reader-capability-snapshot",
    journal,
    reader,
  })).resolves.toMatchObject({ settlement: "unknown" });
  expect(reads).toBe(1);
  expect(expected).toHaveBeenCalledTimes(1);
  expect(poison).not.toHaveBeenCalled();
});

it.each(["signingBytesHex", "transactionBytesHex"] as const)(
  "rejects recovery when frozen %s differs from the observed certificate",
  async (field) => {
    const expected = {
      network: "fast:testnet" as const,
      senderHex: protocol.signerHex as string,
      nonce: BigInt(protocol.nonce as string | number),
      txId: protocol.txId as string,
      sha256: "11".repeat(32),
      claimDataHex: protocol.claimDataHex as string,
    };
    const validated = await validateSettlementCertificate(protocol.certificateRestJson, expected);
    const snapshot: SubmissionUnknownJournalSnapshot = {
      version: 1,
      state: "submission_unknown",
      operationId: "recover-evidence-op",
      updatedAt: 1,
      operation: {
        input: {
          operationId: "recover-evidence-op",
          sha256: expected.sha256,
          relationship: "authored",
          signerName: "Fixture Agent",
          listBySigner: false,
        },
        network: expected.network,
        proxyUrl: "https://proxy.example",
        indexOrigin: "https://index.example",
        senderHex: expected.senderHex,
        nonce: expected.nonce.toString(),
        requestIdHex: "33".repeat(16),
        issuedAtNanoseconds: "1721520000000000000",
        fee: null,
      },
      submission: {
        txId: expected.txId,
        signingBytesHex: field === "signingBytesHex" ? "00" : validated.signingBytesHex,
        transactionBytesHex: field === "transactionBytesHex" ? "00" : validated.transactionBytesHex,
        senderSignatureHex: validated.senderSignatureHex,
        claimDataHex: expected.claimDataHex,
      },
    };
    const save = vi.fn(async () => undefined);
    const journal: RecoveryJournal = {
      load: vi.fn(async () => snapshot),
      save,
      withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
    };

    await expect(recoverSettlement({
      operationId: snapshot.operationId,
      journal,
      reader: {
        origin: snapshot.operation.proxyUrl,
        getCertificate: vi.fn(async () => protocol.certificateRestJson),
      },
    })).rejects.toThrow(`observed ${field === "signingBytesHex" ? "signing" : "transaction"} bytes do not match the frozen submission`);

    expect(save).not.toHaveBeenCalled();
  },
);

it.each([
  ["request ID", { requestIdHex: "44".repeat(16) }, {}],
  ["relationship", {}, { relationship: "approved" as const }],
  ["signer name", {}, { signerName: "Different signer" }],
  ["public title", {}, { publicTitle: "Different title" }],
  ["listing flag", {}, { listBySigner: true, publicTitle: "Listed title" }],
  ["issued timestamp", { issuedAtNanoseconds: "1721520000001000000" }, {}],
] as const)("rejects recovery when frozen %s does not match the attestation", async (_label, operationOverride, inputOverride) => {
  const expected = {
    network: "fast:testnet" as const,
    senderHex: protocol.signerHex as string,
    nonce: BigInt(protocol.nonce as string | number),
    txId: protocol.txId as string,
    sha256: "11".repeat(32),
    claimDataHex: protocol.claimDataHex as string,
  };
  const validated = await validateSettlementCertificate(protocol.certificateRestJson, expected);
  const input = {
    operationId: "recover-metadata-op",
    sha256: expected.sha256,
    relationship: "authored" as const,
    signerName: "Fixture Agent",
    listBySigner: false,
    ...inputOverride,
  };
  const snapshot: SubmissionUnknownJournalSnapshot = {
    version: 1,
    state: "submission_unknown",
    operationId: input.operationId,
    updatedAt: 1,
    operation: {
      input,
      network: expected.network,
      proxyUrl: "https://proxy.example",
      indexOrigin: "https://index.example",
      senderHex: expected.senderHex,
      nonce: expected.nonce.toString(),
      requestIdHex: "33".repeat(16),
      issuedAtNanoseconds: "1721520000000000000",
      fee: null,
      ...operationOverride,
    },
    submission: {
      txId: expected.txId,
      signingBytesHex: validated.signingBytesHex,
      transactionBytesHex: validated.transactionBytesHex,
      senderSignatureHex: validated.senderSignatureHex,
      claimDataHex: expected.claimDataHex,
    },
  };
  const save = vi.fn(async () => undefined);
  const journal: RecoveryJournal = {
    load: vi.fn(async () => snapshot),
    save,
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };

  await expect(recoverSettlement({
    operationId: snapshot.operationId,
    journal,
    reader: {
      origin: snapshot.operation.proxyUrl,
      getCertificate: vi.fn(async () => protocol.certificateRestJson),
    },
  })).rejects.toThrow(
    _label === "issued timestamp"
      ? "observed transaction timestamp does not match the frozen operation"
      : "observed attestation metadata does not match the frozen operation",
  );
  expect(save).not.toHaveBeenCalled();
});

it.each([
  "not an absolute URL",
  "https://proxy.example?",
  "https://proxy.example#",
])("reports a stable validation error for a malformed reader origin: %s", async (origin) => {
  const journal: RecoveryJournal = {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    withLock: vi.fn(async <T>(_key: string, operation: () => Promise<T>) => operation()) as RecoveryJournal["withLock"],
  };

  await expect(recoverSettlement({
    operationId: "recover-op",
    journal,
    reader: { origin, getCertificate: vi.fn(async () => null) },
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

it.each([
  42,
  "https://index.example/private/path",
  "https://user:pass@index.example",
  "https://index.example?",
  "https://index.example#",
] as const)("rejects a verified receipt with an invalid indexOrigin: %s", async (indexOrigin) => {
  const getCertificate = vi.fn(async () => null);
  await expect(verifyReceipt({
    network: "fast:testnet",
    receipt: {
      version: 1,
      operationId: "invalid-index-origin",
      indexOrigin: indexOrigin as unknown as string,
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
      certificate: "{}",
    },
    reader: { origin: "https://proxy.example", getCertificate },
  })).rejects.toThrow(/indexOrigin.*absolute HTTP\(S\) origin|indexOrigin/i);
  expect(getCertificate).not.toHaveBeenCalled();
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
