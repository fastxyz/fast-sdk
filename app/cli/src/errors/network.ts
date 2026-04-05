import { Data } from 'effect';

export class NetworkExistsError extends Data.TaggedError('NetworkExistsError')<{
  readonly name: string;
}> {
  get message() {
    return `Network "${this.name}" already exists`;
  }
}

export class NetworkNotFoundError extends Data.TaggedError('NetworkNotFoundError')<{
  readonly name: string;
}> {
  get message() {
    return `Network "${this.name}" not found`;
  }
}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DefaultNetworkError extends Data.TaggedError('DefaultNetworkError')<{
  readonly name: string;
}> {
  get message() {
    return `Cannot remove "${this.name}" because it is the default network. Use \`fast network set-default\` first.`;
  }
}

export class ReservedNameError extends Data.TaggedError('ReservedNameError')<{
  readonly name: string;
}> {
  get message() {
    return `"${this.name}" is a reserved name and cannot be modified`;
  }
}

export class InvalidConfigError extends Data.TaggedError('InvalidConfigError')<{
  readonly message: string;
}> {}

export class UnsupportedChainError extends Data.TaggedError('UnsupportedChainError')<{
  readonly chain: string;
}> {
  get message() {
    return `Unsupported chain "${this.chain}". Run \`fast info bridge-chains\` to list supported chains.`;
  }
}
