// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

import { encodeAttestationV3, RELATIONSHIPS } from "./internal/attestation.js";
import { createHash } from "node:crypto";
import { hasVisibleMetadataTextV1, validateMetadataTextV1 } from "./internal/metadata.js";
import { fastAddressFromPublicKey } from "./internal/address.js";
import { assertLowerHex, bytesToHex, hexToBytes } from "./internal/bytes.js";
import {
  assertFeePolicy,
  assertFeeSnapshotUnchanged,
  createProxyFeeSource,
  feeTokenForState,
  resolveClaimFee,
  type FeePolicy,
  type FeeSource,
} from "./internal/fees.js";
import { validateSettlementCertificate } from "./internal/receipts.js";
import { snapshotFrozenOperation, snapshotRecoveryJournal } from "./internal/journal-snapshot.js";
import {
  nonceToSafeNumber,
  prepareExternalClaimTransaction,
  signPreparedTransaction,
  type FastSettlementProvider,
} from "./internal/transactions.js";
import {
  assertPublicOperationId,
  type ByteSigner,
  type FrozenOperation,
  type JournalSnapshot,
  type PreparedJournalSnapshot,
  type PendingRegistration,
  type RecoveryJournal,
  type SettledJournalSnapshot,
  type SignInput,
  type SignNetwork,
  type SignedSubmission,
} from "./types.js";
import { createRecordClient, type RegistrationState } from "./record-client.js";
import { asInsufficientFunds, asNonceConflict } from "./errors.js";

const MAX_U64 = (1n << 64n) - 1n;
const PRE_SUBMIT_RETRY_CODE = "pre_submit_evidence_persistence_failed";

export type SignResult =
  | {
      readonly settlement: "settled";
      readonly registration: RegistrationState;
      readonly receipt: PendingRegistration;
      readonly recoveryPersisted: boolean;
    }
  | {
      readonly settlement: "unknown";
      readonly operationId: string;
      readonly txId: string;
      readonly recoveryPersisted: boolean;
    };

export interface SignClientOptions {
  readonly network: SignNetwork;
  readonly proxyUrl: string;
  readonly indexOrigin: string;
  readonly signer: ByteSigner;
  readonly journal: RecoveryJournal;
  readonly feePolicy: FeePolicy;
  readonly provider: FastSettlementProvider;
  readonly feeSource?: FeeSource;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface SignClient {
  signDigest(input: SignInput): Promise<SignResult>;
}

function normalizedHttpUrl(value: string, originOnly: boolean, field: string): string {
  const hasQueryDelimiter = value.includes("?");
  const hasFragmentDelimiter = value.includes("#");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${field} must be an absolute HTTP(S) URL`); }
  if (
    !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    hasQueryDelimiter || hasFragmentDelimiter || url.search || url.hash ||
    (originOnly && (url.pathname !== "/" || url.search))
  ) throw new Error(`${field} must be an absolute public HTTP(S) ${originOnly ? "origin" : "URL"}`);
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}

type NormalizedSignInput = Omit<SignInput, "listBySigner"> & { readonly listBySigner: boolean };

function snapshotSignInput(rawInput: SignInput): NormalizedSignInput {
  // Read each caller-owned property exactly once before validation. Accessors
  // may change their return value between reads, so only this snapshot may be
  // validated or used by the signing and journal paths.
  const operationId = rawInput.operationId;
  const sha256 = rawInput.sha256;
  const relationship = rawInput.relationship;
  const signerName = rawInput.signerName;
  const publicTitle = rawInput.publicTitle;
  const rawListBySigner = rawInput.listBySigner;
  const listBySigner = rawListBySigner === undefined ? false : rawListBySigner;

  return {
    operationId,
    sha256,
    relationship,
    ...(signerName === undefined || signerName === "" ? {} : { signerName }),
    listBySigner,
    ...(listBySigner && publicTitle !== undefined ? { publicTitle } : {}),
  };
}

function validateSignInput(input: NormalizedSignInput): void {
  if (!(RELATIONSHIPS as readonly string[]).includes(input.relationship)) throw new Error("relationship is not supported");
  if (typeof input.listBySigner !== "boolean") throw new Error("listBySigner must be a boolean");
  if (input.signerName !== undefined && typeof input.signerName !== "string") throw new Error("signerName must be text");
  validateMetadataTextV1(input.signerName ?? "");
  if (input.listBySigner) {
    if (input.publicTitle !== undefined && typeof input.publicTitle !== "string") throw new Error("publicTitle must be text");
    const title = input.publicTitle ?? "";
    validateMetadataTextV1(title);
    if (!hasVisibleMetadataTextV1(title)) throw new Error("listed attestations require a visible publicTitle");
  }
}

function sameInput(snapshot: JournalSnapshot, input: NormalizedSignInput): boolean {
  const frozen = snapshot.operation.input;
  return frozen.operationId === input.operationId && frozen.sha256 === input.sha256 &&
    frozen.relationship === input.relationship && frozen.signerName === input.signerName &&
    frozen.publicTitle === input.publicTitle && frozen.listBySigner === input.listBySigner;
}

function nonceReservationOperationId(network: SignNetwork, senderHex: string, nonce: bigint): string {
  const digest = createHash("sha256")
    .update(`${network}\0${senderHex}\0${nonce.toString()}`, "utf8")
    .digest("hex");
  return `nonce-reservation-${digest}`;
}

function reserveNonce(
  existing: JournalSnapshot | null,
  reservationId: string,
  operation: FrozenOperation,
  operationId: string,
  network: SignNetwork,
  senderHex: string,
  nonce: bigint,
  updatedAt: number,
): PreparedJournalSnapshot {
  // A prepared reservation record without the reservation field is the
  // explicit tombstone written when pre-submit evidence persistence failed.
  // It is available for reuse, but remains structurally valid in journals.
  if (existing !== null && existing.state === "prepared" && existing.reservation === undefined) {
    return reserveNonce(null, reservationId, operation, operationId, network, senderHex, nonce, updatedAt);
  }
  if (existing !== null) {
    if (
      existing.operationId !== reservationId ||
      existing.state !== "prepared" ||
      existing.reservation === undefined ||
      existing.reservation.network !== network ||
      existing.reservation.senderHex !== senderHex ||
      existing.reservation.nonce !== nonce.toString()
    ) {
      throw new Error("nonce reservation record is malformed");
    }
    if (existing.reservation.ownerOperationId !== operationId) {
      throw new Error("nonce is reserved by an indeterminate operation");
    }
    return existing;
  }
  const reservationOperation = snapshotFrozenOperation({
    ...operation,
    input: { ...operation.input, operationId: reservationId },
  });
  return {
    version: 1,
    state: "prepared",
    operationId: reservationId,
    updatedAt,
    operation: reservationOperation,
    reservation: { ownerOperationId: operationId, network, senderHex, nonce: nonce.toString() },
  };
}

function assertFrozenClientBindings(
  snapshot: JournalSnapshot,
  network: SignNetwork,
  proxyUrl: string,
  indexOrigin: string,
): void {
  if (
    snapshot.operation.network !== network ||
    snapshot.operation.proxyUrl !== proxyUrl ||
    snapshot.operation.indexOrigin !== indexOrigin
  ) {
    throw new Error("operation does not match the configured network or destinations");
  }
}

function resultFromSettled(snapshot: SettledJournalSnapshot): SignResult {
  const registration: RegistrationState = snapshot.state === "registered" ? "registered"
    : snapshot.state === "registration_conflict" ? "conflict"
      : snapshot.state === "registration_rejected" ? "rejected" : "pending";
  return { settlement: "settled", registration, receipt: snapshot.receipt, recoveryPersisted: true };
}

function certificateFromSubmit(result: unknown): unknown | null {
  if (result && typeof result === "object" && "envelope" in result) return result;
  if (result && typeof result === "object" && (result as { type?: unknown }).type === "Success") {
    return (result as { value?: unknown }).value ?? null;
  }
  return null;
}

export function createSignClient(options: SignClientOptions): SignClient {
  if (options.network !== "fast:testnet" && options.network !== "fast:mainnet") throw new Error("invalid network");
  const network = options.network;
  const proxyUrl = normalizedHttpUrl(options.proxyUrl, false, "proxyUrl");
  const indexOrigin = normalizedHttpUrl(options.indexOrigin, true, "indexOrigin");
  if (!options.signer || typeof options.signer.getPublicKey !== "function" || typeof options.signer.signMessage !== "function") {
    throw new Error("signer must implement getPublicKey() and signMessage(bytes)");
  }
  if (!options.provider || typeof options.provider.getNextNonce !== "function" || typeof options.provider.submitTransaction !== "function") {
    throw new Error("provider must expose nonce read and submit capabilities");
  }
  const signerSource = options.signer;
  const signer: ByteSigner = {
    getPublicKey: signerSource.getPublicKey.bind(signerSource),
    signMessage: signerSource.signMessage.bind(signerSource),
  };
  const providerSource = options.provider;
  const provider: FastSettlementProvider = {
    getNextNonce: providerSource.getNextNonce.bind(providerSource),
    submitTransaction: providerSource.submitTransaction.bind(providerSource),
  };
  const journalSource = options.journal;
  const journal: RecoveryJournal = snapshotRecoveryJournal(journalSource);
  const feePolicy: FeePolicy = { ...options.feePolicy };
  if (feePolicy.feeFreeNetwork !== undefined && typeof feePolicy.feeFreeNetwork !== "boolean") {
    throw new Error("feeFreeNetwork must be a boolean");
  }
  const fetchImpl = options.fetchImpl;
  const now = options.now ?? Date.now;
  const feeSource = options.feeSource === undefined
    ? createProxyFeeSource({ proxyUrl, ...(fetchImpl === undefined ? {} : { fetchImpl }) })
    : {
        networkInfo: options.feeSource.networkInfo.bind(options.feeSource),
        tokenMeta: options.feeSource.tokenMeta.bind(options.feeSource),
      };
  const random = options.randomBytes ?? ((length: number) => {
    const output = new Uint8Array(length);
    globalThis.crypto.getRandomValues(output);
    return output;
  });
  const recordClient = createRecordClient({
    network,
    indexOrigin,
    journal,
    now,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });

  return {
    async signDigest(rawInput) {
      const input = snapshotSignInput(rawInput);
      assertPublicOperationId(input.operationId);
      assertLowerHex(input.sha256, 32, "sha256");
      validateSignInput(input);
      let newSettlement = false;
      const initial = await journal.withLock(`operation:${input.operationId}`, async (): Promise<SignResult> => {
        const existing = await journal.load(input.operationId);
        if (existing) {
          if (!sameInput(existing, input)) throw new Error("operationId is already bound to different immutable inputs");
          assertFrozenClientBindings(existing, network, proxyUrl, indexOrigin);
        }

        const signerPublicKey = await signer.getPublicKey();
        if (!(signerPublicKey instanceof Uint8Array) || signerPublicKey.byteLength !== 32) throw new Error("signer public key must be 32 bytes");
        const publicKey = Uint8Array.from(signerPublicKey);
        const senderHex = bytesToHex(publicKey);
        if (existing && existing.operation.senderHex !== senderHex) {
          throw new Error("operation does not match the configured signer");
        }
        if (existing?.state === "submission_unknown") {
          return { settlement: "unknown", operationId: input.operationId, txId: existing.submission.txId, recoveryPersisted: true };
        }
        if (existing && existing.state !== "prepared") return resultFromSettled(existing);
        return journal.withLock(`account:${network}:${senderHex}`, async (): Promise<SignResult> => {
          const current = await journal.load(input.operationId);
          if (current) {
            if (!sameInput(current, input)) throw new Error("operationId is already bound to different immutable inputs");
            assertFrozenClientBindings(current, network, proxyUrl, indexOrigin);
            if (current.operation.senderHex !== senderHex) {
              throw new Error("operation does not match the configured signer");
            }
          }
          if (current && current.state !== "prepared") {
            if (current.state === "submission_unknown") return { settlement: "unknown", operationId: input.operationId, txId: current.submission.txId, recoveryPersisted: true };
            return resultFromSettled(current);
          }
          const retryablePrepared = current?.state === "prepared" && current.diagnostic?.code === PRE_SUBMIT_RETRY_CODE;
          const signingCurrent = retryablePrepared ? null : current;
          const instant = now();
          if (!Number.isSafeInteger(instant) || instant < 0) throw new Error("clock must return non-negative integer milliseconds");
          const timestampNanos = signingCurrent
            ? BigInt(signingCurrent.operation.issuedAtNanoseconds)
            : BigInt(instant) * 1_000_000n;
          if (timestampNanos < 0n || timestampNanos > MAX_U64) {
            throw new Error("clock timestamp is outside the transaction u64 range");
          }
          const nonce = signingCurrent ? BigInt(signingCurrent.operation.nonce) : await provider.getNextNonce(
            fastAddressFromPublicKey(publicKey),
          );
          nonceToSafeNumber(nonce);
          const quote = await resolveClaimFee(network, feeSource, feePolicy.feeFreeNetwork ?? false);
          if (signingCurrent?.operation.fee === null) throw new Error("an imported settled operation cannot resume signing");
          const authorized = assertFeePolicy(network, quote, feePolicy);
          if (signingCurrent && signingCurrent.operation.fee.scheduleFingerprint !== authorized.scheduleFingerprint) {
            throw new Error("the Fast fee schedule changed since this operation was prepared");
          }
          const randomRequestId = signingCurrent ? hexToBytes(signingCurrent.operation.requestIdHex) : random(16);
          if (!(randomRequestId instanceof Uint8Array) || randomRequestId.byteLength !== 16) {
            throw new Error("randomBytes must return the requested 16 bytes");
          }
          const requestId = Uint8Array.from(randomRequestId);
          const claimDataHex = bytesToHex(encodeAttestationV3({
            digestAlgorithm: "sha256",
            commitmentMode: "public_sha256",
            digest: hexToBytes(input.sha256),
            relationship: input.relationship,
            signer: publicKey,
            requestId,
            issuedAt: signingCurrent
              ? BigInt(signingCurrent.operation.issuedAtNanoseconds) / 1_000_000_000n
              : BigInt(Math.floor(instant / 1000)),
            signerName: input.signerName ?? "",
            fileLabel: input.listBySigner ? (input.publicTitle ?? "") : "",
            listBySigner: input.listBySigner,
            metadataRevision: 1n,
            fastIdAttribution: null,
          }));
          const operation: FrozenOperation = signingCurrent?.operation ?? snapshotFrozenOperation({
            input,
            network,
            proxyUrl,
            indexOrigin,
            senderHex,
            nonce: nonce.toString(),
            requestIdHex: bytesToHex(requestId),
            issuedAtNanoseconds: timestampNanos.toString(),
            fee: authorized,
          });
          if (!signingCurrent) await journal.save({ version: 1, state: "prepared", operationId: input.operationId, updatedAt: instant, operation });
          const reservationId = nonceReservationOperationId(network, senderHex, nonce);
          const existingReservation = await journal.load(reservationId);
          const reservation = reserveNonce(existingReservation, reservationId, operation, input.operationId, network, senderHex, nonce, instant);
          const prepared = await prepareExternalClaimTransaction({
            network, senderPublicKey: publicKey, nonce, claimDataHex,
            feeToken: feeTokenForState(quote), timestampNanos,
          });
          const signed = await signPreparedTransaction(prepared, signer);
          const currentQuote = await resolveClaimFee(network, feeSource, feePolicy.feeFreeNetwork ?? false);
          if (quote.kind === "unavailable") throw new Error("fee became unavailable");
          assertFeeSnapshotUnchanged(network, quote, currentQuote);
          // Do not pin a free nonce until all pre-submit preparation and
          // signing have succeeded. Existing reservations were checked above,
          // so a competing operation still fails before it can sign.
          const reusingReservationTombstone = existingReservation?.state === "prepared" && existingReservation.reservation === undefined;
          const reservationCreatedForThisAttempt = existingReservation === null || reusingReservationTombstone;
          if (reservationCreatedForThisAttempt) await journal.save(reservation);
          const submission: SignedSubmission = {
            txId: signed.txId,
            signingBytesHex: bytesToHex(signed.signingBytes),
            transactionBytesHex: bytesToHex(signed.transactionBytes),
            senderSignatureHex: signed.senderSignatureHex,
            claimDataHex,
          };
          // `instant` was validated before any reservation was created. Reuse
          // it for all pre-submit journal transitions so a second clock read
          // cannot strand a durable reservation without a recoverable state.
          const unknown: JournalSnapshot = { version: 1, state: "submission_unknown", operationId: input.operationId, updatedAt: instant, operation, submission };
          try {
            await journal.save(unknown);
          } catch (error) {
            // No provider call has happened yet. Persist the retry marker
            // while the reservation is still held; only a durable marker may
            // authorize releasing a newly-created reservation. If the marker
            // cannot be saved, retaining the reservation fails closed.
            let retryMarkerPersisted = false;
            try {
              await journal.save({
                version: 1,
                state: "prepared",
                operationId: input.operationId,
                updatedAt: instant,
                operation,
                diagnostic: {
                  code: PRE_SUBMIT_RETRY_CODE,
                  message: "submission evidence could not be persisted before the provider call",
                  at: instant,
                },
              });
              retryMarkerPersisted = true;
            } catch {
              // The durable reservation is the safest fallback.
            }
            if (reservationCreatedForThisAttempt && retryMarkerPersisted) {
              try {
                await journal.save({
                  version: 1,
                  state: "prepared",
                  operationId: reservationId,
                  updatedAt: instant,
                  operation: reservation.operation,
                });
              } catch {
                // Retain the reservation if its release tombstone fails.
              }
            }
            throw error;
          }
          let submitted: unknown;
          try { submitted = await provider.submitTransaction(signed.envelope); }
          catch (error) {
            const nonceConflict = asNonceConflict(error);
            if (nonceConflict) throw nonceConflict;
            const insufficientFunds = asInsufficientFunds(error, authorized.tokenId);
            if (insufficientFunds) throw insufficientFunds;
            return { settlement: "unknown", operationId: input.operationId, txId: signed.txId, recoveryPersisted: true };
          }
          let certificate: unknown | null;
          try {
            // A provider may return a structurally hostile object after the
            // submission was accepted. Property access is therefore part of
            // the post-submit uncertainty boundary, not a pre-submit parse.
            certificate = certificateFromSubmit(submitted);
          } catch {
            return { settlement: "unknown", operationId: input.operationId, txId: signed.txId, recoveryPersisted: true };
          }
          if (certificate === null) return { settlement: "unknown", operationId: input.operationId, txId: signed.txId, recoveryPersisted: true };
          let validated;
          try {
            validated = await validateSettlementCertificate(certificate, {
              network, senderHex, nonce, txId: signed.txId,
              sha256: input.sha256, claimDataHex,
            });
            if (validated.senderSignatureHex !== signed.senderSignatureHex) {
              throw new Error("settlement sender signature does not match the frozen submission");
            }
          } catch {
            // Submit has already been attempted. A missing, malformed, or
            // mismatched response cannot prove that settlement failed, so the
            // durable pre-submit state remains the only honest result. Recovery
            // must observe this same tx read-only; it must never submit again.
            return { settlement: "unknown", operationId: input.operationId, txId: signed.txId, recoveryPersisted: true };
          }
          const receipt: PendingRegistration = {
            version: 1, operationId: input.operationId, indexOrigin,
            record: { sha256: input.sha256, tx_id: signed.txId, signer: senderHex, nonce: nonceToSafeNumber(nonce), network },
            claimDataHex, senderSignatureHex: validated.senderSignatureHex,
            signatureScope: "versioned_transaction", certificate: validated.certificate,
          };
          const settled: SettledJournalSnapshot = { ...unknown, state: "registration_pending", updatedAt: now(), receipt };
          try { await journal.save(settled); }
          catch { return { settlement: "settled", registration: "pending", receipt, recoveryPersisted: false }; }
          newSettlement = true;
          return { settlement: "settled", registration: "pending", receipt, recoveryPersisted: true };
        });
      });
      if (initial.settlement === "unknown" || !initial.recoveryPersisted) return initial;
      if (!newSettlement && initial.registration !== "pending") return initial;
      const registered = await recordClient.retryRegistration(initial.receipt);
      return { settlement: "settled", ...registered };
    },
  };
}
