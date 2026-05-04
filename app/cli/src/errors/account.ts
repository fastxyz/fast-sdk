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

export class MultiSigConfigInvalidError extends Data.TaggedError(
  "MultiSigConfigInvalidError",
)<{ readonly reason: string }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "MULTISIG_CONFIG_INVALID" as const;
  get message() {
    return `Invalid multisig config: ${this.reason}`;
  }
}

export class NotAMemberError extends Data.TaggedError("NotAMemberError")<{
  readonly walletName: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "NOT_A_MEMBER" as const;
  get message() {
    return `You don't have a local account for any signer of multisig wallet "${this.walletName}".`;
  }
}

export class AmbiguousMemberError extends Data.TaggedError(
  "AmbiguousMemberError",
)<{ readonly walletName: string; readonly candidates: readonly string[] }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "AMBIGUOUS_MEMBER" as const;
  get message() {
    return `You have keys for multiple signers of "${this.walletName}" (${this.candidates.join(", ")}). Pass --as <name> to choose one.`;
  }
}

export class AddressDerivationMismatchError extends Data.TaggedError(
  "AddressDerivationMismatchError",
)<{ readonly expected: string; readonly derived: string }> {
  readonly exitCode = 2 as const;
  readonly errorCode = "ADDRESS_DERIVATION_MISMATCH" as const;
  get message() {
    return `Wallet config integrity check failed: expected fast address ${this.expected}, derived ${this.derived}.`;
  }
}

export class AlreadyVotedError extends Data.TaggedError("AlreadyVotedError")<{
  readonly walletName: string;
  readonly txHash: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "ALREADY_VOTED" as const;
  get message() {
    return `You have already signed transaction ${this.txHash} on wallet "${this.walletName}".`;
  }
}

export class WalletKindMismatchError extends Data.TaggedError(
  "WalletKindMismatchError",
)<{
  readonly name: string;
  readonly expected: "single" | "multisig";
  readonly hint?: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "WALLET_KIND_MISMATCH" as const;
  get message() {
    const verb = this.expected === "single" ? "single-signer" : "multisig";
    return `"${this.name}" is not a ${verb} account.${this.hint ? ` ${this.hint}` : ""}`;
  }
}
