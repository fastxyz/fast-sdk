import { Data } from "effect";

/**
 * Proxy-level errors (ProxyError, codes -32000 to -32015).
 *
 * These are returned directly by the FastSet proxy server before
 * forwarding to validators. They cover request validation, faucet
 * limits, and proxy-specific issues.
 */

/**
 * Catch-all proxy error for unexpected failures.
 *
 * Covers network/RPC communication failures, database issues,
 * signature verification failures, and other unexpected conditions.
 *
 * Code: -32000
 */
export class GeneralError extends Data.TaggedError("GeneralError")<{
  readonly message: string;
}> {}

/**
 * Faucet is not enabled on this proxy.
 *
 * The proxy does not have a faucet key configured.
 *
 * Recovery: fund the account through other means (transfer from
 * another account, or contact the network operator).
 *
 * Code: -32001
 */
export class FaucetDisabledError extends Data.TaggedError(
  "FaucetDisabledError",
)<{
  readonly message: string;
}> {}

/**
 * Faucet drip requested too soon after a previous drip.
 *
 * Each recipient+token pair has a cooldown period between drips.
 * The error message contains the remaining cooldown in minutes.
 *
 * Recovery: wait for the cooldown to expire and retry.
 *
 * Code: -32003
 */
export class FaucetThrottledError extends Data.TaggedError(
  "FaucetThrottledError",
)<{
  readonly message: string;
}> {}

/**
 * Faucet drip transaction failed to execute on validators.
 *
 * The proxy attempted to submit the drip transaction but validators
 * rejected it. The usage timer is reset to prevent rapid retries.
 *
 * Recovery: wait for the cooldown and retry. Check the error message
 * for the underlying validator error.
 *
 * Code: -32004
 */
export class FaucetTxnFailedError extends Data.TaggedError(
  "FaucetTxnFailedError",
)<{
  readonly message: string;
}> {}

/**
 * Requested faucet drip amount exceeds the configured limit.
 *
 * Recovery: request a smaller amount. The error message contains
 * the requested amount and the maximum threshold.
 *
 * Code: -32005
 */
export class FaucetThresholdExceededError extends Data.TaggedError(
  "FaucetThresholdExceededError",
)<{
  readonly message: string;
}> {}

/**
 * External claim has verifier signatures from unauthorized signers.
 *
 * One or more verifier signatures are from addresses not listed
 * in the claim's `verifierCommittee`.
 *
 * Recovery: only include signatures from verifiers in the committee.
 *
 * Code: -32006
 */
export class VerifierSigsInvalidError extends Data.TaggedError(
  "VerifierSigsInvalidError",
)<{
  readonly message: string;
}> {}

/**
 * Proxy database operation failed.
 *
 * An internal server error — not caused by the client request.
 *
 * Recovery: retry after a short delay; contact support if persistent.
 *
 * Code: -32012
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
}> {}

/**
 * Certificate query limit exceeds the maximum of 200.
 *
 * Recovery: split into multiple queries with `limit <= 200`.
 *
 * Code: -32013
 */
export class TooManyCertificatesRequestedError extends Data.TaggedError(
  "TooManyCertificatesRequestedError",
)<{
  readonly message: string;
}> {}

/**
 * Transaction nonce doesn't match the proxy's expected nonce.
 *
 * The proxy validates nonces before forwarding to validators.
 * This catches nonce mismatches early.
 *
 * Recovery: call `getAccountInfo()` to fetch the current `nextNonce`,
 * rebuild and resubmit with the correct nonce.
 *
 * Code: -32014
 */
export class ProxyUnexpectedNonceError extends Data.TaggedError(
  "ProxyUnexpectedNonceError",
)<{
  readonly message: string;
  readonly txNonce: bigint;
  readonly expectedNonce: bigint;
}> {}

/**
 * Request violates size or count constraints.
 *
 * Covers: transaction too large, too many signatures, too many
 * verifiers, claim data too large, batch too large, token name
 * too long, too many minters, nonce range too large, or too many
 * token IDs in filter.
 *
 * Recovery: reduce the size or count of elements in the request.
 *
 * Code: -32015
 */
export class InvalidRequestError extends Data.TaggedError(
  "InvalidRequestError",
)<{
  readonly message: string;
}> {}

/** Resource not found (REST 404). */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
}> {}

/** IP rate limited (REST 429). */
export class IpRateLimitedError extends Data.TaggedError(
  "IpRateLimitedError",
)<{
  readonly message: string;
  readonly retryAfterSecs: number;
}> {}

/** Upstream validator error (REST 502). */
export class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly message: string;
}> {}

/** Service unavailable / shutting down (REST 503). */
export class ServiceUnavailableError extends Data.TaggedError(
  "ServiceUnavailableError",
)<{
  readonly message: string;
}> {}
