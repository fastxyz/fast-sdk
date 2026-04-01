import { Schema } from "effect";
import { BigIntFromNumberOrSelf, CamelCaseStruct, TypedVariant } from "../util/index.ts";

/** FastSetError as a TypedVariant — decodes to { type, value } format. */
export const FastSetErrorData = TypedVariant({
  UnexpectedNonce: CamelCaseStruct({
    expected_nonce: BigIntFromNumberOrSelf,
  }),
  InsufficientFunding: CamelCaseStruct({
    current_balance: BigIntFromNumberOrSelf,
  }),
  PreviousTransactionMustBeConfirmedFirst: CamelCaseStruct({
    pending_confirmation: Schema.Unknown,
  }),
  InvalidSignature: Schema.Struct({
    error: Schema.String,
  }),
  MissingEarlierConfirmations: CamelCaseStruct({
    current_nonce: BigIntFromNumberOrSelf,
  }),
  CertificateTooYoung: CamelCaseStruct({
    resend_after_nanos: BigIntFromNumberOrSelf,
  }),
  NonSubmittableOperation: Schema.Struct({
    reason: Schema.String,
  }),
});

export type FastSetErrorData = typeof FastSetErrorData.Type;

/** json_rpc::Error wrapper — FastSet or Generic. */
export const JsonRpcError = TypedVariant({
  FastSet: FastSetErrorData,
  Generic: Schema.String,
});

export type JsonRpcError = typeof JsonRpcError.Type;

/** ProxyError — all variants as a TypedVariant. */
export const ProxyErrorData = TypedVariant({
  GeneralError: Schema.String,
  FaucetDisabled: null,
  RpcError: JsonRpcError,
  FaucetThrottled: Schema.Unknown,
  FaucetTxnFailed: Schema.Unknown,
  FaucetThresholdExceeded: Schema.Unknown,
  VerifierSigsInvalid: Schema.Unknown,
  DatabaseError: Schema.String,
  TooManyCertificatesRequested: null,
  UnexpectedNonce: CamelCaseStruct({
    tx_nonce: BigIntFromNumberOrSelf,
    expected_nonce: BigIntFromNumberOrSelf,
  }),
  InvalidRequest: Schema.String,
});

export type ProxyErrorData = typeof ProxyErrorData.Type;
