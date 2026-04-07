import { Data } from "effect";

export class TxNotFoundError extends Data.TaggedError("TxNotFoundError")<{
  readonly hash: string;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "TX_NOT_FOUND" as const;
  get message() {
    return `Transaction not found: ${this.hash}`;
  }
}

export class TransactionFailedError extends Data.TaggedError(
  "TransactionFailedError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "TX_FAILED" as const;
}

export class InvalidAddressError extends Data.TaggedError(
  "InvalidAddressError",
)<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INVALID_ADDRESS" as const;
}

export class InvalidAmountError extends Data.TaggedError("InvalidAmountError")<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INVALID_AMOUNT" as const;
}

export class InsufficientBalanceError extends Data.TaggedError(
  "InsufficientBalanceError",
)<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INSUFFICIENT_BALANCE" as const;
}

export class InsufficientGasError extends Data.TaggedError(
  "InsufficientGasError",
)<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INSUFFICIENT_GAS" as const;
}

export class TokenNotFoundError extends Data.TaggedError("TokenNotFoundError")<{
  readonly token: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "TOKEN_NOT_FOUND" as const;
  get message() {
    return `Unknown token "${this.token}". Run \`fast info bridge-tokens\` to list supported tokens.`;
  }
}
