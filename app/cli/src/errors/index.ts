export * from "./account.js";
export * from "./helpers.js";
export * from "./io.js";
export * from "./network.js";
export * from "./transaction.js";
export * from "./payment.js";
export * from "./usage.js";

import type { DatabaseError } from "./io.js";
import type {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoDefaultAccountError,
  PasswordRequiredError,
  WrongPasswordError,
} from "./account.js";
import type { FastSdkError, InternalError } from "./io.js";
import type {
  DefaultNetworkError,
  InvalidNetworkConfigError,
  NetworkExistsError,
  NetworkNotFoundError,
  NoDefaultNetworkError,
  ReservedNameError,
  UnsupportedChainError,
} from "./network.js";
import type {
  InsufficientBalanceError,
  InsufficientGasError,
  InvalidAddressError,
  InvalidAmountError,
  TokenNotFoundError,
  TransactionFailedError,
  TxNotFoundError,
} from "./transaction.js";
import type {
  InsufficientPaymentBalanceError,
  InvalidPaymentLinkError,
  PaymentFailedError,
  PaymentRejectedError,
} from "./payment.js";
import type {
  InvalidUsageError,
  NotImplementedError,
  UserCancelledError,
} from "./usage.js";

export interface ClientErrorMeta {
  readonly exitCode: 0 | 1 | 2;
  readonly errorCode: string;
  readonly message: string;
}

export type ClientError =
  | InternalError
  | TxNotFoundError
  | InvalidUsageError
  | AccountExistsError
  | ReservedNameError
  | NetworkExistsError
  | InvalidNetworkConfigError
  | DatabaseError
  | InvalidAddressError
  | InvalidAmountError
  | TokenNotFoundError
  | UnsupportedChainError
  | NotImplementedError
  | AccountNotFoundError
  | NoDefaultAccountError
  | InsufficientBalanceError
  | InsufficientGasError
  | FastSdkError
  | TransactionFailedError
  | UserCancelledError
  | PasswordRequiredError
  | WrongPasswordError
  | DefaultAccountError
  | DefaultNetworkError
  | NetworkNotFoundError
  | NoDefaultNetworkError
  | PaymentRejectedError
  | PaymentFailedError
  | InvalidPaymentLinkError
  | InsufficientPaymentBalanceError;
