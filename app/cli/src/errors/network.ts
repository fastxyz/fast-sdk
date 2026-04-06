import { Data } from "effect";

export class NetworkExistsError extends Data.TaggedError("NetworkExistsError")<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "NETWORK_EXISTS" as const;
  get message() {
    return `Network "${this.name}" already exists`;
  }
}

export class NetworkNotFoundError extends Data.TaggedError(
  "NetworkNotFoundError",
)<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "NETWORK_NOT_FOUND" as const;
  get message() {
    return `Network "${this.name}" not found`;
  }
}


export class DefaultNetworkError extends Data.TaggedError(
  "DefaultNetworkError",
)<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "DEFAULT_NETWORK" as const;
  get message() {
    return `Cannot remove "${this.name}" because it is the default network. Use \`fast network set-default\` first.`;
  }
}

export class NoDefaultNetworkError extends Data.TaggedError(
  "NoDefaultNetworkError",
) {
  readonly exitCode = 2 as const;
  readonly errorCode = "NO_DEFAULT_NETWORK" as const;
  get message() {
    return "No default network set. Use `fast network set-default <name>` to set one.";
  }
}

export class ReservedNameError extends Data.TaggedError("ReservedNameError")<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "RESERVED_NAME" as const;
  get message() {
    return `"${this.name}" is a reserved name and cannot be modified`;
  }
}

export class InvalidConfigError extends Data.TaggedError("InvalidConfigError")<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INVALID_CONFIG" as const;
}

export class UnsupportedChainError extends Data.TaggedError(
  "UnsupportedChainError",
)<{
  readonly chain: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "UNSUPPORTED_CHAIN" as const;
  get message() {
    return `Unsupported chain "${this.chain}". Run \`fast info bridge-chains\` to list supported chains.`;
  }
}
