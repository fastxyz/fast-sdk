// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

const RESERVED_FASTID_LABELS = [
  "api",
  "admin",
  "www",
  "id",
  "app",
  "assets",
  "static",
  "_next",
  "favicon",
  "robots",
] as const;

export class AttestationDecodeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AttestationDecodeError";
  }
}

function fail(code: string, message: string): never {
  throw new AttestationDecodeError(code, message);
}

/** Complete frozen Fast ID wire grammar. No case folding or normalization. */
export function validateFastId(name: string): void {
  const bytes = new TextEncoder().encode(name);
  if (bytes.some((byte) => byte > 0x7f)) fail("bad-fast-id", "must be ASCII");
  if (bytes.length < 3 || bytes.length > 31) fail("bad-fast-id", "length must be 3..=31 bytes");
  const parts = name.split(".");
  if (parts.length !== 2) fail("bad-fast-id", "must be exactly given.family");
  for (const token of parts) {
    if (!/^[a-z0-9_]{1,15}$/.test(token)) {
      fail("bad-fast-id", "each token must be [a-z0-9_], 1..=15");
    }
    if ((RESERVED_FASTID_LABELS as readonly string[]).includes(token)) {
      fail("bad-fast-id", "reserved label");
    }
  }
}
