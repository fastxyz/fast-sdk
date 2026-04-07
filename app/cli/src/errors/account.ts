import { Data } from "effect";

export class AccountExistsError extends Data.TaggedError("AccountExistsError")<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "ACCOUNT_EXISTS" as const;
  get message() {
    return `Account "${this.name}" already exists`;
  }
}

export class AccountNotFoundError extends Data.TaggedError(
  "AccountNotFoundError",
)<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "ACCOUNT_NOT_FOUND" as const;
  get message() {
    return `Account "${this.name}" not found`;
  }
}

export class NoDefaultAccountError extends Data.TaggedError(
  "NoDefaultAccountError",
) {
  readonly exitCode = 2 as const;
  readonly errorCode = "NO_DEFAULT_ACCOUNT" as const;
  get message() {
    return "No default account found. Create one with `fast account create` or set a default with `fast account set-default`.";
  }
}

export class DefaultAccountError extends Data.TaggedError(
  "DefaultAccountError",
)<{
  readonly name: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "DEFAULT_ACCOUNT" as const;
  get message() {
    return `Cannot delete "${this.name}" because it is the default account. Use \`fast account set-default\` first.`;
  }
}

export class PasswordRequiredError extends Data.TaggedError(
  "PasswordRequiredError",
) {
  readonly exitCode = 2 as const;
  readonly errorCode = "PASSWORD_REQUIRED" as const;
  get message() {
    return "Password required. Use --password, FAST_PASSWORD env var, or run in interactive mode.";
  }
}

export class WrongPasswordError extends Data.TaggedError("WrongPasswordError") {
  readonly exitCode = 2 as const;
  readonly errorCode = "WRONG_PASSWORD" as const;
  get message() {
    return "Incorrect password";
  }
}
