import type { ProxyErrorData } from "@fastxyz/schema";
import { ProxyErrorData as ProxyErrorDataSchema } from "@fastxyz/schema";
import { Schema } from "effect";
import {
  CertificateTooYoungError,
  InsufficientFundingError,
  InvalidSignatureError,
  MissingEarlierConfirmationsError,
  NonSubmittableOperationError,
  PreviousTransactionPendingError,
  UnexpectedNonceError,
  ValidatorGenericError,
} from "../error/fastset";
import { JsonRpcProtocolError, RpcError } from "../error/network";
import {
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
} from "../error/proxy";

/** Map a FastSet (validator) RPC error variant to a typed error class. */
const toFastSetError = (
  message: string,
  rpcErr: (ProxyErrorData & { type: "RpcError" })["value"],
) => {
  if (rpcErr.type === "Generic") {
    return new ValidatorGenericError({ message: rpcErr.value });
  }
  const err = rpcErr.value;
  switch (err.type) {
    case "UnexpectedNonce":
      return new UnexpectedNonceError({
        message,
        expectedNonce: err.value.expectedNonce,
      });
    case "InsufficientFunding":
      return new InsufficientFundingError({
        message,
        currentBalance: err.value.currentBalance,
      });
    case "PreviousTransactionMustBeConfirmedFirst":
      return new PreviousTransactionPendingError({
        message,
        pendingConfirmation: err.value.pendingConfirmation,
      });
    case "InvalidSignature":
      return new InvalidSignatureError({ message, error: err.value.error });
    case "MissingEarlierConfirmations":
      return new MissingEarlierConfirmationsError({
        message,
        currentNonce: err.value.currentNonce,
      });
    case "CertificateTooYoung":
      return new CertificateTooYoungError({
        message,
        resendAfterNanos: err.value.resendAfterNanos,
      });
    case "NonSubmittableOperation":
      return new NonSubmittableOperationError({
        message,
        reason: err.value.reason,
      });
    default:
      return new GeneralError({ message });
  }
};

/** Parse a JSON-RPC error response into a typed error. */
export const parseRpcError = (err: {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}) => {
  const { code, message, data } = err;

  if (code <= -32600 && code >= -32700) {
    return new JsonRpcProtocolError({ code, message });
  }

  let parsed: ProxyErrorData;
  try {
    parsed = Schema.decodeUnknownSync(ProxyErrorDataSchema)(data);
  } catch {
    return new RpcError({ code, message, data });
  }

  switch (parsed.type) {
    case "RpcError":
      return toFastSetError(message, parsed.value);
    case "UnexpectedNonce":
      return new ProxyUnexpectedNonceError({
        message,
        txNonce: parsed.value.txNonce,
        expectedNonce: parsed.value.expectedNonce,
      });
    case "GeneralError":
      return new GeneralError({ message: parsed.value });
    case "FaucetDisabled":
      return new FaucetDisabledError({ message });
    case "FaucetThrottled":
      return new FaucetThrottledError({ message });
    case "FaucetTxnFailed":
      return new FaucetTxnFailedError({ message });
    case "FaucetThresholdExceeded":
      return new FaucetThresholdExceededError({ message });
    case "VerifierSigsInvalid":
      return new VerifierSigsInvalidError({ message });
    case "DatabaseError":
      return new DatabaseError({ message: parsed.value });
    case "TooManyCertificatesRequested":
      return new TooManyCertificatesRequestedError({ message });
    case "InvalidRequest":
      return new InvalidRequestError({ message: parsed.value });
    default:
      return new RpcError({ code, message, data });
  }
};
