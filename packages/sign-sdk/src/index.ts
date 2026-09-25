// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export { createSignClient } from "./sign-client.js";
export type { SignClient, SignClientOptions, SignResult } from "./sign-client.js";

export {
  FeePolicyError,
  InsufficientFundsError,
  InvalidSignerSignatureError,
  NonceConflictError,
  SignerMismatchError,
} from "./errors.js";

export { createFastSdkProviderAdapter } from "./internal/transactions.js";
export {
  recoverSettlement,
  registerReceipt,
  verifyReceipt,
} from "./recovery.js";
export type {
  JournalSnapshot,
  RecoveryJournal,
  SettlementReader,
  SettlementRecoveryResult,
  VerifyReceiptResult,
} from "./recovery.js";

export { createRecordClient } from "./record-client.js";
export type {
  RecordClient,
  RecordClientOptions,
  RegistrationResult,
  RegistrationState,
} from "./record-client.js";

export { FileChangedDuringHashError, hashFile } from "./file-hash.js";
export type { HashFileOptions } from "./file-hash.js";
export { createFileJournal } from "./file-journal.js";
export type { FileJournalOptions } from "./file-journal.js";

export type {
  ByteSigner,
  FastSettlementProvider,
  PendingRegistration,
  Relationship,
  SignInput,
  SignNetwork,
} from "./types.js";
