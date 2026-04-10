export * from "./account.js";
export * from "./io.js";
export * from "./network.js";
export * from "./payment.js";
export * from "./transaction.js";
export * from "./usage.js";

import type {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoDefaultAccountError,
  PasswordRequiredError,
  WrongPasswordError,
} from "./account.js";
import type {
  DatabaseError,
  FastSdkError,
  FileIOError,
  InternalError,
} from "./io.js";
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
  InsufficientPaymentBalanceError,
  InvalidPaymentLinkError,
  PaymentFailedError,
  PaymentRejectedError,
} from "./payment.js";
import type {
  FundingRequiredError,
  InsufficientBalanceError,
  InsufficientGasError,
  InvalidAddressError,
  InvalidAmountError,
  TokenNotFoundError,
  TransactionFailedError,
  TxNotFoundError,
} from "./transaction.js";
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
  | FundingRequiredError
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
  | InsufficientPaymentBalanceError
  | FileIOError;
