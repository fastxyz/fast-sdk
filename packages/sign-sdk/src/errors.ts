// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export class FeePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeePolicyError";
  }
}

export class SignerMismatchError extends Error {
  constructor(
    public readonly expectedPublicKeyHex: string,
    public readonly actualPublicKeyHex: string,
  ) {
    super("the caller-owned signer public key does not match the prepared transaction sender");
    this.name = "SignerMismatchError";
  }
}

export class InvalidSignerSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignerSignatureError";
  }
}

export class NonceConflictError extends Error {
  constructor(
    public readonly expectedNonce: bigint | null,
    options?: { cause?: unknown },
  ) {
    super(
      expectedNonce === null
        ? "nonce conflict: account nonce advanced since prepare"
        : `nonce conflict: account expects nonce ${expectedNonce}`,
      options,
    );
    this.name = "NonceConflictError";
  }
}

/** Normalize across duplicate Effect/Fast SDK dependency instances by stable tag. */
export function asNonceConflict(error: unknown): NonceConflictError | null {
  if (!error || typeof error !== "object" || !("_tag" in error)) return null;
  const tag = (error as { _tag?: unknown })._tag;
  if (tag !== "UnexpectedNonceError" && tag !== "ProxyUnexpectedNonceError") return null;
  const expected = (error as { expectedNonce?: unknown }).expectedNonce;
  return new NonceConflictError(typeof expected === "bigint" ? expected : null, { cause: error });
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly tokenId: string | null,
    options?: { cause?: unknown },
  ) {
    super("the account cannot fund the configured settlement fee", options);
    this.name = "InsufficientFundsError";
  }
}

export function asInsufficientFunds(
  error: unknown,
  tokenId: string | null,
): InsufficientFundsError | null {
  if (!error || typeof error !== "object") return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object" || !("InsufficientFundingForFee" in details)) {
    return null;
  }
  return new InsufficientFundsError(tokenId, { cause: error });
}
