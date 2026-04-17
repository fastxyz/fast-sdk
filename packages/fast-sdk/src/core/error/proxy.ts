import { Data } from "effect";

/**
 * Proxy-level errors.
 *
 * These are returned directly by the FastSet proxy server before
 * forwarding to validators. They cover request validation
 * and proxy-specific issues.
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
