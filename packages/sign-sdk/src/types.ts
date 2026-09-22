// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export type SignNetwork = "fast:testnet" | "fast:mainnet";

export type Relationship =
  | "authored"
  | "co_authored"
  | "approved"
  | "published"
  | "reviewed"
  | "witnessed"
  | "received"
  | "official_release";

export interface ByteSigner {
  getPublicKey(): Promise<Uint8Array>;
  signMessage(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface SignInput {
  readonly operationId: string;
  readonly sha256: string;
  readonly relationship: Relationship;
  readonly signerName?: string;
  readonly publicTitle?: string;
  readonly listBySigner?: boolean;
}

export interface FastSettlementProvider {
  getNextNonce(address: string): Promise<bigint>;
  submitTransaction(envelope: unknown): Promise<unknown>;
}

export interface PendingRegistration {
  readonly version: 1;
  readonly operationId: string;
  readonly indexOrigin: string;
  readonly record: {
    readonly sha256: string;
    readonly tx_id: string;
    readonly signer: string;
    readonly nonce: number;
    readonly network: SignNetwork;
  };
  readonly claimDataHex: string;
  readonly senderSignatureHex: string;
  readonly signatureScope: "versioned_transaction";
  readonly certificate: unknown;
}

export interface FrozenSignInput extends Omit<SignInput, "listBySigner"> {
  readonly listBySigner: boolean;
}

export interface FrozenOperation {
  readonly input: FrozenSignInput;
  readonly network: SignNetwork;
  readonly proxyUrl: string;
  readonly indexOrigin: string;
  readonly senderHex: string;
  readonly nonce: string;
  readonly requestIdHex: string;
  readonly issuedAtNanoseconds: string;
  readonly fee: {
    readonly tokenId: string | null;
    readonly amountAtomic: string;
    readonly scheduleFingerprint: string;
  } | null;
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
