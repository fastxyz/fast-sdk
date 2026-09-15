import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";

import { KeySigner, validatedSigner, type Signer } from "../src/signer.js";
import { verifyStrict } from "../src/verify.js";

describe("KeySigner", () => {
  it("derives the fast1 address and signer hex, then signs exact bytes verifiably", async () => {
    const privateKey = new Uint8Array(32).fill(7);
    const signer = await KeySigner.fromPrivateKey(privateKey);

    expect(signer.address).toMatch(/^fast1[a-z0-9]+$/);
    expect(signer.signerHex).toMatch(/^[0-9a-f]{64}$/);
    const message = new TextEncoder().encode("exact bytes");
    const signature = await signer.sign(message);
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyStrict(message, signature, signer.publicKey)).toBe(true);
  });

  it("accepts a bare 64-hex key and rejects malformed key material", async () => {
    const fromHex = await KeySigner.fromPrivateKey("07".repeat(32));
    const fromBytes = await KeySigner.fromPrivateKey(new Uint8Array(32).fill(7));
    expect(fromHex.address).toBe(fromBytes.address);

    await expect(KeySigner.fromPrivateKey("0x" + "07".repeat(32))).rejects.toThrow(/64-hex/i);
    await expect(KeySigner.fromPrivateKey(new Uint8Array(31))).rejects.toThrow(/32 bytes/i);
  });

  it("generates a fresh usable identity", async () => {
    const signer = await KeySigner.generate();
    const message = new Uint8Array([1, 2, 3]);
    expect(verifyStrict(message, await signer.sign(message), signer.publicKey)).toBe(true);
  });

  it("initializes noble hashing when KeySigner is consumed without verifyStrict", async () => {
    const prior = ed.etc.sha512Sync;
    ed.etc.sha512Sync = undefined;
    try {
      const signer = await KeySigner.fromPrivateKey("08".repeat(32));
      const signature = await signer.sign(new Uint8Array([4, 5, 6]));
      expect(signature).toMatch(/^[0-9a-f]{128}$/);
    } finally {
      ed.etc.sha512Sync = prior;
    }
  });

  it("normalizes a custom signer's valid signature to bare lowercase hex", async () => {
    const key = await KeySigner.fromPrivateKey("09".repeat(32));
    const custom: Signer = {
      address: key.address,
      signerHex: key.signerHex,
      publicKey: key.publicKey,
      sign: async (bytes) => `0x${(await key.sign(bytes)).toUpperCase()}`,
    };
    const signature = await validatedSigner(custom).sign(new Uint8Array([7, 8, 9]));
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyStrict(new Uint8Array([7, 8, 9]), signature, key.publicKey)).toBe(true);
  });
});
