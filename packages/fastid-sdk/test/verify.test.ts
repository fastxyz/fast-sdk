import { describe, expect, it } from "vitest";

import { hexToBytes, verifyStrict } from "../src/verify.js";

// RFC 8032 test vector 1: Ed25519 over the empty message.
const publicKey = hexToBytes(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
);
const signature =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
  "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

describe("verifyStrict", () => {
  it("accepts a known-good strict Ed25519 signature and rejects a flipped bit", () => {
    const message = new Uint8Array();
    expect(verifyStrict(message, signature, publicKey)).toBe(true);

    const tampered = `${signature.slice(0, -2)}0a`;
    expect(verifyStrict(message, tampered, publicKey)).toBe(false);
  });

  it("returns false instead of throwing for malformed hex and lengths", () => {
    expect(verifyStrict(new Uint8Array([1]), "not-hex", publicKey)).toBe(false);
    expect(verifyStrict(new Uint8Array([1]), "00".repeat(64), new Uint8Array(31))).toBe(false);
    expect(verifyStrict(new Uint8Array([1]), "00".repeat(32), publicKey)).toBe(false);
  });
});
