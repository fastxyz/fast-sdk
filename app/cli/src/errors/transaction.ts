import { Data } from 'effect';

export class TxNotFoundError extends Data.TaggedError('TxNotFoundError')<{
  readonly hash: string;
}> {
  get message() {
    return `Transaction not found: ${this.hash}`;
  }
}

export class TransactionFailedError extends Data.TaggedError('TransactionFailedError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InvalidAddressError extends Data.TaggedError('InvalidAddressError')<{
  readonly message: string;
}> {}

export class InvalidAmountError extends Data.TaggedError('InvalidAmountError')<{
  readonly message: string;
}> {}

export class InsufficientBalanceError extends Data.TaggedError('InsufficientBalanceError')<{
  readonly message: string;
}> {}

export class InsufficientGasError extends Data.TaggedError('InsufficientGasError')<{
  readonly message: string;
}> {}

export class TokenNotFoundError extends Data.TaggedError('TokenNotFoundError')<{
  readonly token: string;
}> {
  get message() {
    return `Unknown token "${this.token}". Run \`fast info bridge-tokens\` to list supported tokens.`;
  }
}
