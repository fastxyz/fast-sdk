/**
 * All error types that can be thrown by the SDK.
 *
 * Use `instanceof` to match specific errors:
 *
 * ```ts
 * import { UnexpectedNonceError } from "@fastxyz/sdk";
 *
 * try {
 *   await provider.submitTransaction(envelope);
 * } catch (e) {
 *   if (e instanceof UnexpectedNonceError) {
 *     console.log("Retry with nonce:", e.expectedNonce);
 *   }
 * }
 * ```
 *
 * Error hierarchy:
 *
 * - **Network/Transport**: `RestTimeoutError`, `RestError`
 * - **Proxy (request validation)**: `InvalidRequestError`, `NotFoundError`,
 *   `ProxyUnexpectedNonceError`, `TooManyCertificatesRequestedError`,
 *   `DatabaseError`, `GeneralError`
 * - **Proxy (infrastructure)**: `IpRateLimitedError`, `UpstreamError`, `ServiceUnavailableError`
 * - **Validator (protocol)**: `UnexpectedNonceError`, `InsufficientFundingError`,
 *   `InvalidSignatureError`, `PreviousTransactionPendingError`,
 *   `MissingEarlierConfirmationsError`, `CertificateTooYoungError`,
 *   `NonSubmittableOperationError`, `ValidatorGenericError`, `VerifierSigsInvalidError`
 * - **Crypto**: `BcsEncodeError`, `SigningError`, `PublicKeyError`, `VerifyError`
 */

export {
  BcsEncodeError,
  PublicKeyError,
  SigningError,
  VerifyError,
} from "../core/error/crypto";
export {
  CertificateTooYoungError,
  InsufficientFundingError,
  InvalidSignatureError,
  MissingEarlierConfirmationsError,
  NonSubmittableOperationError,
  PreviousTransactionPendingError,
  UnexpectedNonceError,
  ValidatorGenericError,
} from "../core/error/fastset";
export {
  RestError,
  RestTimeoutError,
  RpcTimeoutError,
} from "../core/error/network";
export {
  DatabaseError,
  GeneralError,
  InvalidRequestError,
  IpRateLimitedError,
  NotFoundError,
  ProxyUnexpectedNonceError,
  ServiceUnavailableError,
  TooManyCertificatesRequestedError,
  UpstreamError,
  VerifierSigsInvalidError,
} from "../core/error/proxy";
