export * from "./account.js";
export * from "./helpers.js";
export * from "./io.js";
export * from "./network.js";
export * from "./transaction.js";
export * from "./usage.js";

import type {
  AccountExistsError,
  AccountNotFoundError,
  DefaultAccountError,
  NoAccountsError,
  PasswordRequiredError,
  WrongPasswordError,
} from "./account.js";
import type { InternalError, StorageError } from "./io.js";
import type {
  DefaultNetworkError,
  InvalidConfigError,
  NetworkError,
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
  InvalidUsageError,
  NotImplementedError,
  UserCancelledError,
} from "./usage.js";

export interface CliErrorMeta {
  readonly exitCode: 0 | 1 | 2;
  readonly errorCode: string;
  readonly message: string;
}

export type ClientError =
  | InternalError
  | StorageError
  | TxNotFoundError
  | InvalidUsageError
  | AccountExistsError
  | ReservedNameError
  | NetworkExistsError
  | InvalidConfigError
  | InvalidAddressError
  | InvalidAmountError
  | TokenNotFoundError
  | UnsupportedChainError
  | NotImplementedError
  | AccountNotFoundError
  | NoAccountsError
  | InsufficientBalanceError
  | InsufficientGasError
  | NetworkError
  | TransactionFailedError
  | UserCancelledError
  | PasswordRequiredError
  | WrongPasswordError
  | DefaultAccountError
  | DefaultNetworkError
  | NetworkNotFoundError
  | NoDefaultNetworkError;
