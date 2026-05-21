import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { fingerprint } from "../../src/wallet/key-handover/crypto/fingerprint";

describe("fingerprint", () => {
  it("formats as 6-digit string", () => {
    const fp = fingerprint(new TextEncoder().encode("anything"));
    expect(fp).toMatch(/^\d{6}$/);
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

  it('golden vector: "vector" encodes to 756440', () => {
    expect(fingerprint(new TextEncoder().encode("vector"))).toBe("756440");
  });

  it("matches inline reference implementation", () => {
    const bytes = new TextEncoder().encode("fast.xyz");
    expect(fingerprint(bytes)).toBe(manualFingerprint(bytes));
  });
});

function manualFingerprint(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  const value =
    (digest[0] * 0x1000000 +
      digest[1] * 0x10000 +
      digest[2] * 0x100 +
      digest[3]) %
    1_000_000;
  return value.toString().padStart(6, "0");
}
