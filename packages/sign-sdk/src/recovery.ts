// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Relationship } from "./internal/attestation.js";
import type { AuthorizedFee } from "./internal/fees.js";
import { assertOperationId, type PendingRegistration, type SignNetwork } from "./types.js";
import { SETTLEMENT_TRUST, assertBoundedObjectCertificate, certificatesEqual, validateSettlementCertificate } from "./internal/receipts.js";
import { validateRecordRequest } from "./internal/record-wire.js";
import { nonceToSafeNumber } from "./internal/transactions.js";
import { bytesToHex } from "./internal/bytes.js";
import { createIndexHttpClient } from "./internal/index-http.js";
import { createRecordClient, type RegistrationState } from "./record-client.js";

export interface FrozenSignInput {
  readonly operationId: string;
  readonly sha256: string;
  readonly relationship: Relationship;
  readonly signerName?: string;
  readonly publicTitle?: string;
  readonly listBySigner: boolean;
}

export interface FrozenOperation {
  readonly input: FrozenSignInput;
  readonly network: SignNetwork;
  readonly proxyUrl: string;
  readonly indexOrigin: string;
  readonly senderHex: string;
  /** Unsigned integer encoded losslessly as canonical decimal text. */
  readonly nonce: string;
  readonly requestIdHex: string;
  /** Unsigned nanoseconds encoded losslessly as canonical decimal text. */
  readonly issuedAtNanoseconds: string;
  /** Null only for an already-settled externally imported receipt. */
  readonly fee: AuthorizedFee | null;
}

export interface SignedSubmission {
  readonly txId: string;
  readonly signingBytesHex: string;
  readonly transactionBytesHex: string;
  readonly senderSignatureHex: string;
  readonly claimDataHex: string;
}

export interface RecoveryDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly at: number;
  readonly status?: number;
}

interface JournalSnapshotBase {
  readonly version: 1;
  readonly operationId: string;
  readonly updatedAt: number;
  readonly operation: FrozenOperation;
  readonly diagnostic?: RecoveryDiagnostic;
  readonly nextRegistrationAttemptAt?: number;
}

export interface PreparedJournalSnapshot extends JournalSnapshotBase {
  readonly state: "prepared";
}

export interface SubmissionUnknownJournalSnapshot extends JournalSnapshotBase {
  readonly state: "submission_unknown";
  readonly submission: SignedSubmission;
}

export interface SettledJournalSnapshot extends JournalSnapshotBase {
  readonly registrationAttempts?: number;
  readonly state:
    | "settled"
    | "registration_pending"
    | "registration_conflict"
    | "registration_rejected"
    | "registered";
  readonly submission: SignedSubmission;
  readonly receipt: PendingRegistration;
}

export type JournalSnapshot =
  | PreparedJournalSnapshot
  | SubmissionUnknownJournalSnapshot
  | SettledJournalSnapshot;

export interface RecoveryJournal {
  load(operationId: string): Promise<JournalSnapshot | null>;
  save(snapshot: JournalSnapshot): Promise<void>;
  withLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T>;
}

export interface SettlementReader {
  /** Configured public proxy URL, used to bind read-only recovery to its frozen destination. */
  readonly origin: string;
  getCertificate(input: {
    readonly network: SignNetwork;
    readonly senderHex: string;
    readonly nonce: bigint;
    readonly txId: string;
  }): Promise<unknown | null>;
}

export type VerifyReceiptResult =
  | {
      readonly status: "verified";
      readonly settlementTrust: typeof SETTLEMENT_TRUST;
      readonly quorumVerified: false;
      readonly receipt: PendingRegistration;
    }
  | {
      readonly status: "not_observed";
      readonly settlementTrust: typeof SETTLEMENT_TRUST;
      readonly quorumVerified: false;
      readonly receipt: PendingRegistration;
    };

function snapshotReceipt(receipt: PendingRegistration): PendingRegistration {
  if (receipt.version !== 1) throw new Error("receipt version must be 1");
  assertOperationId(receipt.operationId);
  const record = validateRecordRequest(receipt.record);
  const certificate = receipt.certificate;
  if (typeof certificate !== "string") assertBoundedObjectCertificate(certificate);
  return {
    version: receipt.version,
    operationId: receipt.operationId,
    indexOrigin: receipt.indexOrigin,
    record,
    claimDataHex: receipt.claimDataHex,
    senderSignatureHex: receipt.senderSignatureHex,
    signatureScope: receipt.signatureScope,
    certificate: typeof certificate === "string" ? certificate : structuredClone(certificate),
  };
}

function snapshotSettlementReader(reader: SettlementReader): SettlementReader {
  if (!reader || typeof reader.getCertificate !== "function") {
    throw new Error("reader must provide only the read-only getCertificate capability");
  }
  const origin = normalizeProxyOrigin(reader.origin);
  const getCertificate = reader.getCertificate.bind(reader);
  return { origin, getCertificate };
}

function snapshotRecoveryJournal(journal: RecoveryJournal): RecoveryJournal {
  if (
    !journal ||
    typeof journal.load !== "function" ||
    typeof journal.save !== "function" ||
    typeof journal.withLock !== "function"
  ) {
    throw new Error("journal must provide load, save, and withLock capabilities");
  }
  return {
    load: journal.load.bind(journal),
    save: journal.save.bind(journal),
    withLock: journal.withLock.bind(journal),
  };
}

function receiptExpectation(receipt: PendingRegistration, network: SignNetwork) {
  const record = validateRecordRequest(receipt.record);
  if (record.network !== network) throw new Error("receipt network does not match the configured network");
  if (receipt.signatureScope !== "versioned_transaction") throw new Error("receipt signature scope is invalid");
  if (receipt.claimDataHex.length === 0 || !/^(?:[0-9a-f]{2})+$/.test(receipt.claimDataHex)) {
    throw new Error("receipt claimDataHex must be non-empty lowercase hex");
  }
  if (!/^[0-9a-f]{128}$/.test(receipt.senderSignatureHex)) throw new Error("receipt sender signature is invalid");
  return {
    network,
    senderHex: record.signer,
    nonce: BigInt(record.nonce),
    txId: record.tx_id,
    sha256: record.sha256,
    claimDataHex: receipt.claimDataHex,
  };
}

export async function verifyReceipt(options: {
  readonly receipt: PendingRegistration;
  readonly network: SignNetwork;
  readonly reader: SettlementReader;
}): Promise<VerifyReceiptResult> {
  const receipt = snapshotReceipt(options.receipt);
  const network = options.network;
  const reader = snapshotSettlementReader(options.reader);
  const expected = receiptExpectation(receipt, network);
  const provided = await validateSettlementCertificate(receipt.certificate, expected);
  if (provided.senderSignatureHex !== receipt.senderSignatureHex) {
    throw new Error("receipt sender signature does not match its certificate");
  }
  const canonicalReceipt: PendingRegistration = { ...receipt, certificate: provided.certificate };
  const observed = await reader.getCertificate({
    network,
    senderHex: expected.senderHex,
    nonce: expected.nonce,
    txId: expected.txId,
  });
  if (observed === null) {
    return { status: "not_observed", settlementTrust: SETTLEMENT_TRUST, quorumVerified: false, receipt: canonicalReceipt };
  }
  const observedEvidence = await validateSettlementCertificate(observed, expected);
  if (observedEvidence.senderSignatureHex !== canonicalReceipt.senderSignatureHex) {
    throw new Error("observed sender signature does not match the receipt");
  }
  return { status: "verified", settlementTrust: SETTLEMENT_TRUST, quorumVerified: false, receipt: { ...canonicalReceipt, certificate: observedEvidence.certificate } };
}

function normalizeProxyOrigin(value: string | undefined): string {
  if (!value) throw new Error("reader.origin is required to import a receipt into an empty journal");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("reader.origin must be a configured public HTTP(S) proxy URL");
  }
  return url.href.replace(/\/$/, "");
}

export async function registerReceipt(options: {
  readonly receipt: PendingRegistration;
  readonly network: SignNetwork;
  readonly indexOrigin: string;
  readonly journal: RecoveryJournal;
  readonly reader: SettlementReader;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly now?: () => number;
}): Promise<{ settlement: "settled"; registration: RegistrationState; receipt: PendingRegistration; recoveryPersisted: boolean }> {
  const receipt = snapshotReceipt(options.receipt);
  const network = options.network;
  const journal = snapshotRecoveryJournal(options.journal);
  const reader = snapshotSettlementReader(options.reader);
  const fetchImpl = options.fetchImpl;
  const nowOption = options.now;
  const indexOrigin = createIndexHttpClient({ network, indexOrigin: options.indexOrigin }).indexOrigin;
  const receiptIndexOrigin = createIndexHttpClient({ network, indexOrigin: receipt.indexOrigin }).indexOrigin;
  if (receiptIndexOrigin !== indexOrigin) throw new Error("receipt index origin does not match configured origin");
  const existingBeforeVerification = await journal.load(receipt.operationId);
  if (
    existingBeforeVerification &&
    existingBeforeVerification.state !== "prepared" &&
    existingBeforeVerification.state !== "submission_unknown" &&
    normalizeProxyOrigin(existingBeforeVerification.operation.proxyUrl) !== reader.origin
  ) {
    throw new Error("receipt proxy does not match the frozen operation proxy");
  }
  const verification = await verifyReceipt({ receipt: { ...receipt, indexOrigin: receiptIndexOrigin }, network, reader });
  if (verification.status !== "verified") throw new Error("receipt settlement was not observed through the configured proxy");
  const durableReceipt = verification.receipt;
  const validated = await validateSettlementCertificate(
    durableReceipt.certificate,
    receiptExpectation(durableReceipt, network),
  );
  const now = nowOption ?? Date.now;
  const persisted = await journal.withLock(`operation:${durableReceipt.operationId}`, async () => {
    const existing = await journal.load(durableReceipt.operationId);
    if (existing) {
      if (existing.state === "prepared" || existing.state === "submission_unknown") {
        throw new Error("existing operation has not been durably settled");
      }
      if (normalizeProxyOrigin(existing.operation.proxyUrl) !== reader.origin) {
        throw new Error("receipt proxy does not match the frozen operation proxy");
      }
      const existingReceipt = existing.receipt;
      const existingRecord = validateRecordRequest(existingReceipt.record);
      if (
        existingReceipt.version !== durableReceipt.version ||
        existingReceipt.operationId !== durableReceipt.operationId ||
        existingReceipt.indexOrigin !== durableReceipt.indexOrigin ||
        existingRecord.sha256 !== durableReceipt.record.sha256 ||
        existingRecord.tx_id !== durableReceipt.record.tx_id ||
        existingRecord.signer !== durableReceipt.record.signer ||
        existingRecord.nonce !== durableReceipt.record.nonce ||
        existingRecord.network !== durableReceipt.record.network ||
        existingReceipt.claimDataHex !== durableReceipt.claimDataHex ||
        existingReceipt.senderSignatureHex !== durableReceipt.senderSignatureHex ||
        existingReceipt.signatureScope !== durableReceipt.signatureScope ||
        !certificatesEqual(existingReceipt.certificate, durableReceipt.certificate)
      ) {
        throw new Error("operationId is bound to another receipt");
      }
      return true;
    }
    const operation: FrozenOperation = {
      input: {
        operationId: durableReceipt.operationId,
        sha256: durableReceipt.record.sha256,
        relationship: validated.attestation.relationship,
        ...(validated.attestation.signerName === "" ? {} : { signerName: validated.attestation.signerName }),
        ...(validated.attestation.listBySigner ? { publicTitle: validated.attestation.fileLabel } : {}),
        listBySigner: validated.attestation.listBySigner,
      },
      network,
      proxyUrl: reader.origin,
      indexOrigin,
      senderHex: validated.senderHex,
      nonce: validated.nonce.toString(),
      requestIdHex: bytesToHex(validated.attestation.requestId),
      issuedAtNanoseconds: validated.timestampNanos.toString(),
      fee: null,
    };
    const submission: SignedSubmission = {
      txId: validated.txId,
      signingBytesHex: validated.signingBytesHex,
      transactionBytesHex: validated.transactionBytesHex,
      senderSignatureHex: validated.senderSignatureHex,
      claimDataHex: validated.claimDataHex,
    };
    const snapshot: SettledJournalSnapshot = {
      version: 1,
      state: "registration_pending",
      operationId: durableReceipt.operationId,
      updatedAt: now(),
      operation,
      submission,
      receipt: durableReceipt,
    };
    try { await journal.save(snapshot); return true; }
    catch { return false; }
  });
  if (!persisted) {
    return { settlement: "settled", registration: "pending", receipt: durableReceipt, recoveryPersisted: false };
  }
  const result = await createRecordClient({
    network,
    indexOrigin,
    journal,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(nowOption === undefined ? {} : { now: nowOption }),
  }).retryRegistration(durableReceipt);
  return { settlement: "settled", ...result };
}

export type SettlementRecoveryResult =
  | {
      readonly settlement: "settled";
      readonly registration: "registered" | "pending" | "conflict" | "rejected";
      readonly receipt: PendingRegistration;
      readonly recoveryPersisted: boolean;
    }
  | {
      readonly settlement: "unknown";
      readonly operationId: string;
      readonly txId: string;
      readonly recoveryPersisted: boolean;
    };

function registrationState(snapshot: SettledJournalSnapshot): "registered" | "pending" | "conflict" | "rejected" {
  if (snapshot.state === "registered") return "registered";
  if (snapshot.state === "registration_conflict") return "conflict";
  if (snapshot.state === "registration_rejected") return "rejected";
  return "pending";
}

export async function recoverSettlement(options: {
  readonly operationId: string;
  readonly journal: RecoveryJournal;
  readonly reader: SettlementReader;
  readonly now?: () => number;
}): Promise<SettlementRecoveryResult> {
  const operationId = options.operationId;
  assertOperationId(operationId);
  const journal = snapshotRecoveryJournal(options.journal);
  const reader = snapshotSettlementReader(options.reader);
  const now = options.now ?? Date.now;
  return journal.withLock(`operation:${operationId}`, async () => {
    const snapshot = await journal.load(operationId);
    if (!snapshot) throw new Error(`No recovery state exists for operation ${operationId}`);
    if (normalizeProxyOrigin(reader.origin) !== normalizeProxyOrigin(snapshot.operation.proxyUrl)) {
      throw new Error("recovery reader proxy does not match the frozen operation proxy");
    }
    if (
      snapshot.state === "settled" ||
      snapshot.state === "registration_pending" ||
      snapshot.state === "registration_conflict" ||
      snapshot.state === "registration_rejected" ||
      snapshot.state === "registered"
    ) {
      return {
        settlement: "settled",
        registration: registrationState(snapshot),
        receipt: snapshot.receipt,
        recoveryPersisted: true,
      };
    }
    if (snapshot.state === "prepared") {
      throw new Error("Operation has not reached submission_unknown; there is no settlement to recover");
    }

    const nonce = BigInt(snapshot.operation.nonce);
    const certificate = await reader.getCertificate({
      network: snapshot.operation.network,
      senderHex: snapshot.operation.senderHex,
      nonce,
      txId: snapshot.submission.txId,
    });
    if (certificate === null) {
      return {
        settlement: "unknown",
        operationId,
        txId: snapshot.submission.txId,
        recoveryPersisted: true,
      };
    }
    const validated = await validateSettlementCertificate(certificate, {
      network: snapshot.operation.network,
      senderHex: snapshot.operation.senderHex,
      nonce,
      txId: snapshot.submission.txId,
      sha256: snapshot.operation.input.sha256,
      claimDataHex: snapshot.submission.claimDataHex,
    });
    if (validated.senderSignatureHex !== snapshot.submission.senderSignatureHex) {
      throw new Error("observed sender signature does not match the frozen submission");
    }
    const receipt: PendingRegistration = {
      version: 1,
      operationId,
      indexOrigin: snapshot.operation.indexOrigin,
      record: {
        sha256: snapshot.operation.input.sha256,
        tx_id: validated.txId,
        signer: validated.senderHex,
        nonce: nonceToSafeNumber(validated.nonce),
        network: snapshot.operation.network,
      },
      claimDataHex: validated.claimDataHex,
      senderSignatureHex: validated.senderSignatureHex,
      signatureScope: "versioned_transaction",
      certificate: validated.certificate,
    };
    const recovered: SettledJournalSnapshot = {
      ...snapshot,
      state: "registration_pending",
      updatedAt: now(),
      receipt,
    };
    try {
      await journal.save(recovered);
      return { settlement: "settled", registration: "pending", receipt, recoveryPersisted: true };
    } catch {
      return { settlement: "settled", registration: "pending", receipt, recoveryPersisted: false };
    }
  });
}
