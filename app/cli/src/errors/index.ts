import { Data } from "effect";

// Exit code 1 — General / storage errors
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class TxNotFoundError extends Data.TaggedError("TxNotFoundError")<{
  readonly hash: string;
}> {
  get message() {
    return `Transaction not found: ${this.hash}`;
  }
}

// Exit code 2 — Invalid usage
export class InvalidUsageError extends Data.TaggedError("InvalidUsageError")<{
  readonly message: string;
}> {}

export class AccountExistsError extends Data.TaggedError("AccountExistsError")<{
  readonly name: string;
}> {
  get message() {
    return `Account "${this.name}" already exists`;
  }
}

export class ReservedNameError extends Data.TaggedError("ReservedNameError")<{
  readonly name: string;
}> {
  get message() {
    return `"${this.name}" is a reserved name and cannot be modified`;
  }
}

export class NetworkExistsError extends Data.TaggedError("NetworkExistsError")<{
  readonly name: string;
}> {
  get message() {
    return `Network "${this.name}" already exists`;
  }
}

export class InvalidConfigError extends Data.TaggedError("InvalidConfigError")<{
  readonly message: string;
}> {}

export class InvalidAddressError extends Data.TaggedError(
  "InvalidAddressError",
)<{
  readonly message: string;
}> {}

export class InvalidAmountError extends Data.TaggedError("InvalidAmountError")<{
  readonly message: string;
}> {}

export class TokenNotFoundError extends Data.TaggedError("TokenNotFoundError")<{
  readonly token: string;
}> {
  get message() {
    return `Unknown token "${this.token}". Run \`fast info bridge-tokens\` to list supported tokens.`;
  }
}

// Exit code 3 — Account not found
export class AccountNotFoundError extends Data.TaggedError(
  "AccountNotFoundError",
)<{
  readonly name: string;
}> {
  get message() {
    return `Account "${this.name}" not found`;
  }
}

export class NoAccountsError extends Data.TaggedError("NoAccountsError")<{}> {
  get message() {
    return "No accounts found. Create one with `fast account create`.";
  }
}

// Exit code 4 — Insufficient balance
export class InsufficientBalanceError extends Data.TaggedError(
  "InsufficientBalanceError",
)<{
  readonly message: string;
}> {}

// Exit code 5 — Network error
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Exit code 6 — Transaction failed
export class TransactionFailedError extends Data.TaggedError(
  "TransactionFailedError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Exit code 7 — User cancelled
export class UserCancelledError extends Data.TaggedError(
  "UserCancelledError",
)<{}> {
  get message() {
    return "Operation cancelled by user";
  }
}

// Exit code 8 — Password errors
export class PasswordRequiredError extends Data.TaggedError(
  "PasswordRequiredError",
)<{}> {
  get message() {
    return "Password required. Use --password, FAST_PASSWORD env var, or run in interactive mode.";
  }
}

export class WrongPasswordError extends Data.TaggedError(
  "WrongPasswordError",
)<{}> {
  get message() {
    return "Incorrect password";
  }
}

export class DefaultAccountError extends Data.TaggedError(
  "DefaultAccountError",
)<{
  readonly name: string;
}> {
  get message() {
    return `Cannot delete "${this.name}" because it is the default account. Use \`fast account set-default\` first.`;
  }
}

export class DefaultNetworkError extends Data.TaggedError(
  "DefaultNetworkError",
)<{
  readonly name: string;
}> {
  get message() {
    return `Cannot remove "${this.name}" because it is the default network. Use \`fast network set-default\` first.`;
  }
}

export class NetworkNotFoundError extends Data.TaggedError(
  "NetworkNotFoundError",
)<{
  readonly name: string;
}> {
  get message() {
    return `Network "${this.name}" not found`;
  }
}

// --- Exit code mapping ---

export type CliError =
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
  | AccountNotFoundError
  | NoAccountsError
  | InsufficientBalanceError
  | NetworkError
  | TransactionFailedError
  | UserCancelledError
  | PasswordRequiredError
  | WrongPasswordError
  | DefaultAccountError
  | DefaultNetworkError
  | NetworkNotFoundError;

const exitCodeMap: Record<string, number> = {
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
  DefaultAccountError: 2,
  DefaultNetworkError: 2,
  AccountNotFoundError: 3,
  NoAccountsError: 3,
  InsufficientBalanceError: 4,
  NetworkError: 5,
  TransactionFailedError: 6,
  UserCancelledError: 7,
  PasswordRequiredError: 8,
  WrongPasswordError: 8,
  NetworkNotFoundError: 2,
};

export const toExitCode = (error: { readonly _tag: string }): number =>
  exitCodeMap[error._tag] ?? 1;

const errorCodeMap: Record<string, string> = {
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
  DefaultAccountError: "DEFAULT_ACCOUNT",
  DefaultNetworkError: "DEFAULT_NETWORK",
  AccountNotFoundError: "ACCOUNT_NOT_FOUND",
  NoAccountsError: "NO_ACCOUNTS",
  InsufficientBalanceError: "INSUFFICIENT_BALANCE",
  NetworkError: "NETWORK_ERROR",
  TransactionFailedError: "TX_FAILED",
  UserCancelledError: "USER_CANCELLED",
  PasswordRequiredError: "PASSWORD_REQUIRED",
  WrongPasswordError: "WRONG_PASSWORD",
  NetworkNotFoundError: "NETWORK_NOT_FOUND",
};

export const toErrorCode = (error: { readonly _tag: string }): string =>
  errorCodeMap[error._tag] ?? "UNKNOWN_ERROR";
