import { Data } from "effect";

/**
 * Validator-level protocol errors (FastSetError).
 *
 * These are returned by validators and wrapped by the proxy inside
 * ProxyError::RpcError (code -32002). They indicate protocol-level
 * issues with the transaction itself.
 */

/**
 * Transaction nonce doesn't match the account's expected next nonce.
 *
 * Happens when the account's nonce has advanced (e.g., another transaction
 * was confirmed) since the client last checked.
 *
 * Recovery: call `getAccountInfo()` to fetch the current `nextNonce`,
 * then rebuild and resubmit the transaction with the correct nonce.
 */
export class UnexpectedNonceError extends Data.TaggedError(
  "UnexpectedNonceError",
)<{
  readonly message: string;
  readonly expectedNonce: bigint;
}> {}

/**
 * Account balance is insufficient for the operation.
 *
 * Happens when a transfer, burn, or fee payment exceeds the account's
 * available balance for the relevant token.
 *
 * Recovery: check balance via `getAccountInfo()`, then either reduce
 * the amount or fund the account first.
 */
export class InsufficientFundingError extends Data.TaggedError(
  "InsufficientFundingError",
)<{
  readonly message: string;
  readonly currentBalance: bigint;
}> {}

/**
 * Account has a pending unconfirmed transaction.
 *
 * The validator requires the previous transaction to be confirmed
 * (included in a certificate) before accepting a new one from
 * the same account.
 *
 * Recovery: wait for the pending transaction to be confirmed, then
 * resubmit. The `pendingConfirmation` field contains the blocking
 * transaction envelope.
 */
export class PreviousTransactionPendingError extends Data.TaggedError(
  "PreviousTransactionPendingError",
)<{
  readonly message: string;
  readonly pendingConfirmation: unknown;
}> {}

/**
 * Transaction or certificate signature verification failed.
 *
 * The Ed25519 signature does not match the transaction content and
 * the sender's public key.
 *
 * Recovery: ensure the transaction is signed with the correct private
 * key and that the transaction content hasn't been modified after signing.
 */
export class InvalidSignatureError extends Data.TaggedError(
  "InvalidSignatureError",
)<{
  readonly message: string;
  readonly error: string;
}> {}

/**
 * Validator is missing earlier transaction confirmations.
 *
 * The validator's local state is behind — it hasn't seen confirmations
 * for transactions preceding this one.
 *
 * Recovery: retry after a short delay; the validator may catch up.
 */
export class MissingEarlierConfirmationsError extends Data.TaggedError(
  "MissingEarlierConfirmationsError",
)<{
  readonly message: string;
  readonly currentNonce: bigint;
}> {}

/**
 * Certificate was submitted too soon after an epoch boundary.
 *
 * For committee join/leave operations, there is a mandatory delay
 * after epoch transitions before certificates are accepted.
 *
 * Recovery: wait the specified nanoseconds before resubmitting.
 */
export class CertificateTooYoungError extends Data.TaggedError(
  "CertificateTooYoungError",
)<{
  readonly message: string;
  readonly resendAfterNanos: bigint;
}> {}

/**
 * The operation is not submittable in the current context.
 *
 * Covers cases like invalid batch combinations (e.g., multiple
 * external claims), unauthorized operations, unknown token IDs,
 * or invalid state transitions.
 *
 * Recovery: check the `reason` field for specifics and adjust
 * the transaction accordingly.
 */
export class NonSubmittableOperationError extends Data.TaggedError(
  "NonSubmittableOperationError",
)<{
  readonly message: string;
  readonly reason: string;
}> {}

/**
 * Validator returned a non-FastSet error (json_rpc::Error::Generic).
 *
 * A catch-all for validator errors that don't map to a specific
 * FastSetError variant. Check the message for details.
 */
export class ValidatorGenericError extends Data.TaggedError(
  "ValidatorGenericError",
)<{
  readonly message: string;
}> {}
