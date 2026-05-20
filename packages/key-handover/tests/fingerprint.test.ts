import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/crypto/fingerprint.ts";

describe("fingerprint", () => {
  it("formats as uppercase XXXX-XXXX Crockford Base32", () => {
    const fp = fingerprint(new TextEncoder().encode("anything"));
    expect(fp).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("is deterministic for the same bytes", () => {
    const bytes = new TextEncoder().encode("fast.xyz");
    expect(fingerprint(bytes)).toBe(fingerprint(bytes));
  });

  it("differs when input bytes differ by one byte", () => {
    const a = fingerprint(new Uint8Array([1, 2, 3]));
    const b = fingerprint(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it("uses the first 5 bytes of SHA-256 (40 bits = 8 Crockford chars)", () => {
    const bytes = new TextEncoder().encode("vector");
    const digest = sha256(bytes);
    const expected = manualCrockford(digest.slice(0, 5));
    expect(fingerprint(bytes)).toBe(expected);
  });
});

function manualCrockford(bytes: Uint8Array): string {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 7; i >= 0; i--) {
    const shift = BigInt(i * 5);
    out += ALPHABET[Number((bits >> shift) & 31n)];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}
