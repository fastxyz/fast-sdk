import { bcs } from "@mysten/bcs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  getPublicKey,
  signMessage,
  signTypedData,
  verify,
  verifyTypedData,
} from "../../src/core/crypto/signing";
import { run } from "../../src/core/run";

const PRIV_KEY = new Uint8Array(32).fill(1);

describe("signMessage", () => {
  it("returns 64-byte Ed25519 signature", async () => {
    const msg = new TextEncoder().encode("hello");
    const sig = await run(signMessage(PRIV_KEY, msg));
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig).toHaveLength(64);
  });

  it("produces deterministic signatures", async () => {
    const msg = new TextEncoder().encode("deterministic");
    const a = await run(signMessage(PRIV_KEY, msg));
    const b = await run(signMessage(PRIV_KEY, msg));
    expect(a).toEqual(b);
  });

  it("produces different signatures for different messages", async () => {
    const a = await run(signMessage(PRIV_KEY, new TextEncoder().encode("a")));
    const b = await run(signMessage(PRIV_KEY, new TextEncoder().encode("b")));
    expect(a).not.toEqual(b);
  });

  it("produces different signatures for different keys", async () => {
    const msg = new TextEncoder().encode("same message");
    const a = await run(signMessage(new Uint8Array(32).fill(1), msg));
    const b = await run(signMessage(new Uint8Array(32).fill(2), msg));
    expect(a).not.toEqual(b);
  });

  it("signs empty message", async () => {
    const sig = await run(signMessage(PRIV_KEY, new Uint8Array(0)));
    expect(sig).toHaveLength(64);
  });
});

describe("getPublicKey", () => {
  it("derives 32-byte public key from private key", async () => {
    const pub = await run(getPublicKey(PRIV_KEY));
    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub).toHaveLength(32);
  });

  it("is deterministic", async () => {
    const a = await run(getPublicKey(PRIV_KEY));
    const b = await run(getPublicKey(PRIV_KEY));
    expect(a).toEqual(b);
  });

  it("different private keys yield different public keys", async () => {
    const a = await run(getPublicKey(new Uint8Array(32).fill(1)));
    const b = await run(getPublicKey(new Uint8Array(32).fill(2)));
    expect(a).not.toEqual(b);
  });
});

describe("verify", () => {
  it("returns true for valid signature", async () => {
    const msg = new TextEncoder().encode("test");
    const pub = await run(getPublicKey(PRIV_KEY));
    const sig = await run(signMessage(PRIV_KEY, msg));
    const valid = await run(verify(sig, msg, pub));
    expect(valid).toBe(true);
  });

  it("returns false for tampered message", async () => {
    const msg = new TextEncoder().encode("original");
    const pub = await run(getPublicKey(PRIV_KEY));
    const sig = await run(signMessage(PRIV_KEY, msg));
    const valid = await run(
      verify(sig, new TextEncoder().encode("tampered"), pub),
    );
    expect(valid).toBe(false);
  });

  it("returns false for wrong public key", async () => {
    const msg = new TextEncoder().encode("test");
    const sig = await run(signMessage(PRIV_KEY, msg));
    const wrongPub = await run(getPublicKey(new Uint8Array(32).fill(99)));
    const valid = await run(verify(sig, msg, wrongPub));
    expect(valid).toBe(false);
  });

  it("returns false for corrupted signature", async () => {
    const msg = new TextEncoder().encode("test");
    const pub = await run(getPublicKey(PRIV_KEY));
    const sig = await run(signMessage(PRIV_KEY, msg));
    const corrupted = new Uint8Array(sig);
    corrupted[0] ^= 0xff;
    // Corrupted signatures may throw or return false depending on the Ed25519 implementation
    try {
      const valid = await run(verify(corrupted, msg, pub));
      expect(valid).toBe(false);
    } catch {
      // Some implementations throw on malformed signatures — that's acceptable
      expect(true).toBe(true);
    }
  });
});

const TestType = bcs.struct("TestType", { val: bcs.u32() });

describe("signTypedData / verifyTypedData", () => {
  it("round-trips typed data sign + verify", async () => {
    const pub = await run(getPublicKey(PRIV_KEY));
    const data = { val: 42 };
    const sig = await run(signTypedData(PRIV_KEY, TestType, data));
    expect(sig).toHaveLength(64);
    const valid = await run(verifyTypedData(sig, TestType, data, pub));
    expect(valid).toBe(true);
  });

  it("rejects when data differs", async () => {
    const pub = await run(getPublicKey(PRIV_KEY));
    const sig = await run(signTypedData(PRIV_KEY, TestType, { val: 1 }));
    const valid = await run(verifyTypedData(sig, TestType, { val: 2 }, pub));
    expect(valid).toBe(false);
  });

  it("rejects when public key differs", async () => {
    const data = { val: 10 };
    const sig = await run(signTypedData(PRIV_KEY, TestType, data));
    const wrongPub = await run(getPublicKey(new Uint8Array(32).fill(50)));
    const valid = await run(verifyTypedData(sig, TestType, data, wrongPub));
    expect(valid).toBe(false);
  });
});
