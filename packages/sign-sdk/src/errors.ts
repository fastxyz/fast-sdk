// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

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
