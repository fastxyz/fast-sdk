import type { ClaimDataKind } from "./claim-data.js";

export interface SubmissionRecovery {
  readonly nonce?: bigint;
  readonly txIdHex: string;
  readonly recoveryEnvelope: unknown;
}

export class NotSettledError extends Error {
  constructor(
    public readonly tag: string,
    public readonly recovery?: SubmissionRecovery,
  ) {
    super(`transaction was not settled: ${tag}`);
    this.name = "NotSettledError";
  }
}

export class NonceConflictError extends Error {
  constructor(
    public readonly expectedNonce: bigint | null,
    options?: { cause?: unknown },
  ) {
    super(
      expectedNonce !== null
        ? `nonce conflict: account expects nonce ${expectedNonce}`
        : "nonce conflict: account nonce advanced since prepare",
      options,
    );
    this.name = "NonceConflictError";
  }
}

/**
 * Normalize the SDK's tagged nonce-mismatch errors by `_tag`. `instanceof`
 * cannot be trusted when Effect-backed SDK schemas are present in more than
 * one dependency copy.
 */
export function asNonceConflict(err: unknown): NonceConflictError | null {
  if (!err || typeof err !== "object" || !("_tag" in err)) return null;
  const tag = (err as { _tag?: unknown })._tag;
  if (tag !== "UnexpectedNonceError" && tag !== "ProxyUnexpectedNonceError") {
    return null;
  }
  const expected = (err as { expectedNonce?: unknown }).expectedNonce;
  return new NonceConflictError(typeof expected === "bigint" ? expected : null, {
    cause: err,
  });
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly symbol: string,
    options?: { cause?: unknown },
  ) {
    super(`insufficient ${symbol} to pay the settlement fee`, options);
    this.name = "InsufficientFundsError";
  }
}

/**
 * Normalize the proxy's stable `InsufficientFundingForFee` details variant.
 * As above, this deliberately avoids `instanceof` across dependency copies.
 */
export function asInsufficientFunds(
  err: unknown,
  symbol: string,
): InsufficientFundsError | null {
  if (!err || typeof err !== "object") return null;
  const details = (err as { details?: unknown }).details;
  const funding =
    !!details &&
    typeof details === "object" &&
    "InsufficientFundingForFee" in details;
  if (!funding) return null;
  return new InsufficientFundsError(symbol, { cause: err });
}

export class SettlementMismatchError extends Error {
  constructor(
    public readonly submittedTxId: string,
    public readonly certTxId: string,
    public readonly recovery?: SubmissionRecovery,
  ) {
    super(
      `settled certificate does not match the submitted transaction (submitted ${submittedTxId}, certificate ${certTxId})`,
    );
    this.name = "SettlementMismatchError";
  }
}

export class WrongNetworkError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
    public readonly recovery?: SubmissionRecovery,
  ) {
    super(`settled certificate is for network ${actual}, expected ${expected}`);
    this.name = "WrongNetworkError";
  }
}

/** A failure proven to have occurred before an authorized submission. No fee was paid. */
export class PreSubmitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PreSubmitError";
  }
}

export class NameUnavailableError extends PreSubmitError {
  constructor(public readonly verdict: string) {
    super(`name claim preflight did not permit settlement: ${verdict}`);
    this.name = "NameUnavailableError";
  }
}

export class PropertyAlreadyClaimedError extends PreSubmitError {
  constructor(
    public readonly kind: string,
    public readonly value: string,
  ) {
    super(`${kind} value is already claimed`);
    this.name = "PropertyAlreadyClaimedError";
  }
}

export class ClaimNotHeldError extends PreSubmitError {
  constructor(
    public readonly kind: string,
    public readonly value: string,
  ) {
    super(`the signer does not hold an active ${kind} claim for ${value}`);
    this.name = "ClaimNotHeldError";
  }
}

export class FeeUnavailableError extends PreSubmitError {
  constructor() {
    super("the authoritative settlement fee is unavailable; refusing to sign");
    this.name = "FeeUnavailableError";
  }
}

export class InvalidClaimError extends PreSubmitError {
  constructor(options?: { cause?: unknown }) {
    super("claim value could not be encoded canonically", options);
    this.name = "InvalidClaimError";
  }
}

export class NonceFetchError extends PreSubmitError {
  constructor(options?: { cause?: unknown }) {
    super("could not obtain the next account nonce", options);
    this.name = "NonceFetchError";
  }
}

export class SigningError extends PreSubmitError {
  constructor(options?: { cause?: unknown }) {
    super("the signer did not produce a signature", options);
    this.name = "SigningError";
  }
}

export class LocalVerificationError extends PreSubmitError {
  constructor() {
    super("the locally produced signature did not verify; refusing submission");
    this.name = "LocalVerificationError";
  }
}

export class InvalidSignerError extends PreSubmitError {
  constructor() {
    super("signer address, public key, and signer hex do not identify one canonical key");
    this.name = "InvalidSignerError";
  }
}

/** Provider submission may have reached settlement. Never treat this as permission to pay again. */
export class IndeterminateSubmissionError extends Error {
  readonly mayHavePaid = true;
  readonly recovery?: SubmissionRecovery;
  readonly nonce?: bigint;
  readonly txIdHex?: string;
  readonly recoveryEnvelope?: unknown;

  constructor(
    public readonly network: string,
    public readonly address: string,
    options?: { cause?: unknown; recovery?: SubmissionRecovery },
  ) {
    super(
      "claim submission outcome is indeterminate; check the address and transaction state before attempting another paid claim",
      options,
    );
    this.name = "IndeterminateSubmissionError";
    this.recovery = options?.recovery;
    this.nonce = options?.recovery?.nonce;
    this.txIdHex = options?.recovery?.txIdHex;
    this.recoveryEnvelope = options?.recovery?.recoveryEnvelope;
  }
}

export interface PendingRegistrationShape {
  op: "claim" | "revoke";
  network: string;
  addressHex: string;
  name?: string;
  kind?: ClaimDataKind;
  value?: string;
  nonce: string;
  txIdHex: string;
}

export class RegistrationPendingError extends Error {
  readonly feeSpent = true;

  constructor(
    public readonly pending: PendingRegistrationShape,
    options?: { cause?: unknown },
  ) {
    super(
      "the claim settled, but registration is not definitive; retry this registration record without submitting another paid transaction",
      options,
    );
    this.name = "RegistrationPendingError";
  }
}

export type TerminalRegistrationDisposition =
  | "rejected"
  | "conflict"
  | "invalid";

export class RegistrationTerminalError extends Error {
  readonly feeSpent = true;

  constructor(
    public readonly disposition: TerminalRegistrationDisposition,
    public readonly reason?: string,
  ) {
    super(
      `the settled claim registration is terminal (${disposition})${reason ? `: ${reason}` : ""}`,
    );
    this.name = "RegistrationTerminalError";
  }
}

export class PendingNetworkMismatchError extends Error {
  constructor(
    public readonly pendingNetwork: string,
    public readonly clientNetwork: string,
  ) {
    super(
      `pending registration is for ${pendingNetwork}, but this client is bound to ${clientNetwork}`,
    );
    this.name = "PendingNetworkMismatchError";
  }
}

export class InvalidPendingRegistrationError extends Error {
  constructor(
    public readonly operation: unknown,
    public readonly reason = "unsupported operation",
  ) {
    super(`pending registration is invalid: ${reason}`);
    this.name = "InvalidPendingRegistrationError";
  }
}

export class InvalidProofInputError extends PreSubmitError {
  constructor(
    public readonly kind: string,
    public readonly value: string,
  ) {
    super(`invalid ${kind} proof value: ${value}`);
    this.name = "InvalidProofInputError";
  }
}

export class OAuthProofUnavailableError extends PreSubmitError {
  constructor(
    public readonly provider: "github" | "orcid",
    public readonly value: string,
    options?: { cause?: unknown },
  ) {
    super(`no usable ${provider} OAuth proof is available for ${value}`, options);
    this.name = "OAuthProofUnavailableError";
  }
}

export class OAuthProofTimeoutError extends PreSubmitError {
  constructor(
    public readonly provider: "github" | "orcid",
    public readonly value: string,
  ) {
    super(`timed out waiting for the ${provider} OAuth proof for ${value}`);
    this.name = "OAuthProofTimeoutError";
  }
}

export class ProofWaitCancelledError extends PreSubmitError {
  constructor() {
    super("proof wait was cancelled");
    this.name = "ProofWaitCancelledError";
  }
}

/** A website claim has paid, but the index has not yet observed its proof file. */
export class WebsiteVerificationPendingError extends Error {
  readonly feeSpent = true;

  constructor(
    public readonly host: string,
    public readonly txIdHex: string,
    public readonly nonce: string,
  ) {
    super(`website claim settled, but verification is still pending for ${host}`);
    this.name = "WebsiteVerificationPendingError";
  }
}

export class ProofProtocolError extends PreSubmitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProofProtocolError";
  }
}

export class ReadTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`read timed out after ${timeoutMs} ms`);
    this.name = "ReadTimeoutError";
  }
}

export class ReadCancelledError extends Error {
  constructor() {
    super("read was cancelled");
    this.name = "ReadCancelledError";
  }
}

export class InvalidReadResponseError extends Error {
  constructor(public readonly endpoint: string) {
    super(`${endpoint} returned a malformed successful response`);
    this.name = "InvalidReadResponseError";
  }
}

export class XSettlementNotAuthorizedError extends PreSubmitError {
  constructor(public readonly reason: string) {
    super(`X settlement is not authorized: ${reason}`);
    this.name = "XSettlementNotAuthorizedError";
  }
}

export class ProfileReadError extends PreSubmitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProfileReadError";
  }
}

export class ProfileChallengeError extends PreSubmitError {
  constructor(
    public readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(
      status === null
        ? "could not obtain a profile challenge"
        : `profile challenge failed with status ${status}`,
      options,
    );
    this.name = "ProfileChallengeError";
  }
}

export class InvalidProfileError extends PreSubmitError {
  constructor(public readonly reason?: string) {
    super(reason ? `invalid profile update: ${reason}` : "invalid profile update");
    this.name = "InvalidProfileError";
  }
}

export class ProfileUnauthorizedError extends Error {
  constructor() {
    super("profile update was unauthorized or its challenge expired");
    this.name = "ProfileUnauthorizedError";
  }
}

export class ProfileUpdateError extends Error {
  constructor(public readonly status: number) {
    super(`profile update failed with status ${status}`);
    this.name = "ProfileUpdateError";
  }
}

export class IndeterminateProfileUpdateError extends Error {
  readonly mayHaveCommitted = true;

  constructor(options?: { cause?: unknown }) {
    super(
      "profile update result is indeterminate; read the profile before signing another update",
      options,
    );
    this.name = "IndeterminateProfileUpdateError";
  }
}

export class InvalidReportError extends Error {
  constructor(public readonly reason: string) {
    super(`invalid report: ${reason}`);
    this.name = "InvalidReportError";
  }
}

export class ReportConfigError extends Error {
  constructor(
    options?: { cause?: unknown },
    public readonly status?: number,
  ) {
    super(
      status === undefined
        ? "report configuration is unavailable or malformed"
        : `report configuration failed with status ${status}`,
      options,
    );
    this.name = "ReportConfigError";
  }
}

export class ReportSealError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("could not seal the report to the configured recipients", options);
    this.name = "ReportSealError";
  }
}

export class ReportBodyTooLargeError extends Error {
  constructor(
    public readonly serializedBytes: number,
    public readonly limit: number,
  ) {
    super(
      `serialized report body is ${serializedBytes} bytes; limit is ${limit} bytes`,
    );
    this.name = "ReportBodyTooLargeError";
  }
}

export class ReportCiphertextTooLargeError extends Error {
  constructor(
    public readonly ciphertextBytes: number,
    public readonly limit: number,
    public readonly recipientKeyId: string,
  ) {
    super(
      `sealed report ciphertext for ${recipientKeyId} is ${ciphertextBytes} bytes; limit is ${limit} bytes`,
    );
    this.name = "ReportCiphertextTooLargeError";
  }
}

export class ReportRejectedError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(
      `report intake rejected the envelope with status ${status}${reason ? `: ${reason}` : ""}`,
    );
    this.name = "ReportRejectedError";
  }
}

export class IndeterminateReportSubmissionError extends Error {
  readonly mayHaveStored = true;

  constructor(options?: { cause?: unknown }) {
    super(
      "report submission result is indeterminate; the intake may have stored it",
      options,
    );
    this.name = "IndeterminateReportSubmissionError";
  }
}
