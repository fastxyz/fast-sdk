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
 * - **Network/Transport**: `RpcTimeoutError`, `RpcError`
 * - **JSON-RPC Protocol**: `JsonRpcProtocolError`
 * - **Proxy (request validation)**: `InvalidRequestError`, `ProxyUnexpectedNonceError`,
 *   `TooManyCertificatesRequestedError`, `DatabaseError`, `GeneralError`
 * - **Proxy (faucet)**: `FaucetDisabledError`, `FaucetThrottledError`,
 *   `FaucetTxnFailedError`, `FaucetThresholdExceededError`
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
  JsonRpcProtocolError,
  RpcError,
  RpcTimeoutError,
} from "../core/error/network";
export {
  DatabaseError,
  FaucetDisabledError,
  FaucetThresholdExceededError,
  FaucetThrottledError,
  FaucetTxnFailedError,
  GeneralError,
  InvalidRequestError,
  ProxyUnexpectedNonceError,
  TooManyCertificatesRequestedError,
  VerifierSigsInvalidError,
} from "../core/error/proxy";
