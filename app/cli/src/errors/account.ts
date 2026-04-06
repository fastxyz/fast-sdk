import { Data } from "effect";

export class AccountExistsError extends Data.TaggedError("AccountExistsError")<{
  readonly name: string;
}> {
  get message() {
    return `Account "${this.name}" already exists`;
  }
}

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

export class DefaultAccountError extends Data.TaggedError(
  "DefaultAccountError",
)<{
  readonly name: string;
}> {
  get message() {
    return `Cannot delete "${this.name}" because it is the default account. Use \`fast account set-default\` first.`;
  }
}

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
