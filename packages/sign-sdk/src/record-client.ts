// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { assertBoundedObjectCertificate, certificatesEqual } from "./internal/receipts.js";
import {
  createIndexHttpClient,
  IndexHttpError,
  normalizeIndexOrigin,
  type FetchLike,
  type IndexSettlement,
} from "./internal/index-http.js";
import { validateRecordRequest } from "./internal/record-wire.js";
import { snapshotRecoveryJournal } from "./internal/journal-snapshot.js";
import {
  assertOperationId,
  type PendingRegistration,
  type RecoveryJournal,
  type SettledJournalSnapshot,
  type SignNetwork,
} from "./types.js";

export type RegistrationState = "registered" | "pending" | "conflict" | "rejected";

export interface RegistrationResult {
  readonly registration: RegistrationState;
  readonly receipt: PendingRegistration;
  readonly recoveryPersisted: boolean;
  readonly error?: string;
}

export interface RecordClientOptions {
  readonly network: SignNetwork;
  readonly indexOrigin: string;
  readonly journal: RecoveryJournal;
  readonly fetchImpl?: FetchLike;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface RecordClient {
  retryRegistration(receipt: PendingRegistration): Promise<RegistrationResult>;
  checkRegistration(receipt: PendingRegistration): Promise<RegistrationResult>;
}

function snapshotReceipt(value: PendingRegistration): PendingRegistration {
  assertBoundedObjectCertificate(value);
  const receipt = structuredClone(value);
  if (receipt.version !== 1 || typeof receipt.operationId !== "string") throw new Error("receipt identity is invalid");
  assertOperationId(receipt.operationId);
  const record = validateRecordRequest(receipt.record);
  if (!/^(?:[0-9a-f]{2})+$/.test(receipt.claimDataHex)) throw new Error("receipt claimDataHex is invalid");
  if (!/^[0-9a-f]{128}$/.test(receipt.senderSignatureHex)) throw new Error("receipt sender signature is invalid");
  if (receipt.signatureScope !== "versioned_transaction") throw new Error("receipt signature scope is invalid");
  return { ...receipt, record };
}

function sameRecord(left: PendingRegistration["record"], right: PendingRegistration["record"]): boolean {
  const leftRecord = validateRecordRequest(left);
  const rightRecord = validateRecordRequest(right);
  return leftRecord.sha256 === rightRecord.sha256 && leftRecord.tx_id === rightRecord.tx_id &&
    leftRecord.signer === rightRecord.signer && leftRecord.nonce === rightRecord.nonce &&
    leftRecord.network === rightRecord.network;
}

function sameReceipt(left: PendingRegistration, right: PendingRegistration): boolean {
  return left.version === right.version && left.operationId === right.operationId &&
    left.indexOrigin === right.indexOrigin &&
    sameRecord(left.record, right.record) &&
    left.claimDataHex === right.claimDataHex && left.senderSignatureHex === right.senderSignatureHex &&
    left.signatureScope === right.signatureScope &&
    (typeof left.certificate === "string" && typeof right.certificate === "string"
      ? left.certificate === right.certificate
      : certificatesEqual(left.certificate, right.certificate));
}

function rowMatches(row: IndexSettlement, receipt: PendingRegistration): boolean {
  const record = receipt.record;
  return row.sha256 === record.sha256 && row.tx_id.toLowerCase() === record.tx_id &&
    row.signer.toLowerCase() === record.signer && row.network === record.network && row.nonce === record.nonce;
}

function stateOf(snapshot: SettledJournalSnapshot): RegistrationState {
  if (snapshot.state === "registered") return "registered";
  if (snapshot.state === "registration_conflict") return "conflict";
  if (snapshot.state === "registration_rejected") return "rejected";
  return "pending";
}

function journalState(state: RegistrationState): SettledJournalSnapshot["state"] {
  if (state === "registered") return "registered";
  if (state === "conflict") return "registration_conflict";
  if (state === "rejected") return "registration_rejected";
  return "registration_pending";
}

export function createRecordClient(options: RecordClientOptions): RecordClient {
  const journal = snapshotRecoveryJournal(options.journal);
  const http = createIndexHttpClient({
    network: options.network,
    indexOrigin: options.indexOrigin,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const now = options.now ?? Date.now;

  async function withSnapshot(
    rawReceipt: PendingRegistration,
    operation: (receipt: PendingRegistration, snapshot: SettledJournalSnapshot) => Promise<{ state: RegistrationState; error?: string }>,
  ): Promise<RegistrationResult> {
    const receipt = snapshotReceipt(rawReceipt);
    if (receipt.record.network !== options.network || normalizeIndexOrigin(receipt.indexOrigin) !== http.indexOrigin) {
      throw new Error("receipt does not match the configured network or index origin");
    }
    return journal.withLock(`operation:${receipt.operationId}`, async () => {
      const loaded = await journal.load(receipt.operationId);
      if (!loaded || loaded.state === "prepared" || loaded.state === "submission_unknown") {
        throw new Error("receipt is not bound to a settled journal operation");
      }
      const durableReceipt = snapshotReceipt(loaded.receipt);
      if (!sameReceipt(durableReceipt, receipt)) throw new Error("receipt does not match the durable settlement candidate");
      if (loaded.state === "registered") return { registration: "registered", receipt: durableReceipt, recoveryPersisted: true };
      const outcome = await operation(durableReceipt, loaded);
      const next: SettledJournalSnapshot = {
        ...loaded,
        state: journalState(outcome.state),
        updatedAt: now(),
        ...(outcome.error === undefined ? {} : { diagnostic: { code: `registration_${outcome.state}`, message: outcome.error, at: now() } }),
      };
      try {
        await journal.save(next);
        return { registration: outcome.state, receipt: durableReceipt, recoveryPersisted: true, ...(outcome.error === undefined ? {} : { error: outcome.error }) };
      } catch {
        return { registration: outcome.state, receipt: durableReceipt, recoveryPersisted: false, ...(outcome.error === undefined ? {} : { error: outcome.error }) };
      }
    });
  }

  const reconcile = async (receipt: PendingRegistration): Promise<{ state: RegistrationState; error?: string }> => {
    const row = await http.fetchExact(receipt.record);
    if (row === null) return { state: "pending" };
    return rowMatches(row, receipt)
      ? { state: "registered" }
      : { state: "conflict", error: "the exact index row does not match the durable receipt" };
  };

  return {
    checkRegistration(receipt) {
      return withSnapshot(receipt, async (durable, snapshot) => {
        const result = await reconcile(durable);
        return result.state === "pending" && stateOf(snapshot) !== "pending"
          ? { state: stateOf(snapshot), ...(snapshot.diagnostic === undefined ? {} : { error: snapshot.diagnostic.message }) }
          : result;
      });
    },
    retryRegistration(receipt) {
      return withSnapshot(receipt, async (durable, snapshot) => {
        if (snapshot.state === "registration_rejected") return { state: "rejected", ...(snapshot.diagnostic === undefined ? {} : { error: snapshot.diagnostic.message }) };
        try {
          await http.record(durable.record);
          return { state: "registered" };
        } catch (error) {
          if (error instanceof IndexHttpError && error.kind === "conflict") {
            const result = await reconcile(durable);
            return result.state === "pending" ? { state: "conflict", error: error.message } : result;
          }
          if (error instanceof IndexHttpError && (error.kind === "retryable" || error.kind === "transport")) {
            return { state: "pending", error: error.message };
          }
          return { state: "rejected", error: error instanceof Error ? error.message : String(error) };
        }
      });
    },
  };
}
