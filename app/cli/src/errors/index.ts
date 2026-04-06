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

const exitCodeMap: Record<string, number> = {
  InternalError: 1,
  StorageError: 1,
  TxNotFoundError: 1,
  InvalidUsageError: 2,
  AccountExistsError: 2,
  ReservedNameError: 2,
  NetworkExistsError: 2,
  InvalidConfigError: 2,
  InvalidAddressError: 2,
  InvalidAmountError: 2,
  TokenNotFoundError: 2,
  UnsupportedChainError: 2,
  NotImplementedError: 2,
  DefaultAccountError: 2,
  DefaultNetworkError: 2,
  AccountNotFoundError: 3,
  NoAccountsError: 3,
  InsufficientBalanceError: 4,
  InsufficientGasError: 4,
  NetworkError: 5,
  TransactionFailedError: 6,
  UserCancelledError: 7,
  PasswordRequiredError: 8,
  WrongPasswordError: 8,
  NetworkNotFoundError: 2,
  NoDefaultNetworkError: 2,
};

export const toExitCode = (error: { readonly _tag: string }): number =>
  exitCodeMap[error._tag] ?? 1;

const errorCodeMap: Record<string, string> = {
  InternalError: "INTERNAL_ERROR",
  StorageError: "STORAGE_ERROR",
  TxNotFoundError: "TX_NOT_FOUND",
  InvalidUsageError: "INVALID_USAGE",
  AccountExistsError: "ACCOUNT_EXISTS",
  ReservedNameError: "RESERVED_NAME",
  NetworkExistsError: "NETWORK_EXISTS",
  InvalidConfigError: "INVALID_CONFIG",
  InvalidAddressError: "INVALID_ADDRESS",
  InvalidAmountError: "INVALID_AMOUNT",
  TokenNotFoundError: "TOKEN_NOT_FOUND",
  UnsupportedChainError: "UNSUPPORTED_CHAIN",
  NotImplementedError: "NOT_IMPLEMENTED",
  DefaultAccountError: "DEFAULT_ACCOUNT",
  DefaultNetworkError: "DEFAULT_NETWORK",
  AccountNotFoundError: "ACCOUNT_NOT_FOUND",
  NoAccountsError: "NO_ACCOUNTS",
  InsufficientBalanceError: "INSUFFICIENT_BALANCE",
  InsufficientGasError: "INSUFFICIENT_GAS",
  NetworkError: "NETWORK_ERROR",
  TransactionFailedError: "TX_FAILED",
  UserCancelledError: "USER_CANCELLED",
  PasswordRequiredError: "PASSWORD_REQUIRED",
  WrongPasswordError: "WRONG_PASSWORD",
  NetworkNotFoundError: "NETWORK_NOT_FOUND",
  NoDefaultNetworkError: "NO_DEFAULT_NETWORK",
};

export const toErrorCode = (error: { readonly _tag: string }): string =>
  errorCodeMap[error._tag] ?? "UNKNOWN_ERROR";
