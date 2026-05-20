import { describe, expect, it } from "vitest";
import {
  HPKE_INFO,
  exportRecipientPublicKey,
  generateKeyPair,
  hpkeOpen,
  hpkeSeal,
} from "../src/crypto/hpke.ts";

describe("hpke", () => {
  it("seals to a recipient public key and opens with the private key", async () => {
    const kp = await generateKeyPair();
    const recipientPub = await exportRecipientPublicKey(kp.publicKey);
    expect(recipientPub).toHaveLength(32);

    const plaintext = new TextEncoder().encode("secret payload");
    const aad = new TextEncoder().encode("request-bytes");

    const { enc, ciphertext } = await hpkeSeal({
      recipientPublicKey: recipientPub,
      plaintext,
      aad,
    });
    expect(enc).toHaveLength(32);

    const opened = await hpkeOpen({
      recipientPrivateKey: kp.privateKey,
      enc,
      ciphertext,
      aad,
    });
    expect(new Uint8Array(opened)).toEqual(plaintext);
  });

  it("fails to open when AAD differs", async () => {
    const kp = await generateKeyPair();
    const recipientPub = await exportRecipientPublicKey(kp.publicKey);
    const { enc, ciphertext } = await hpkeSeal({
      recipientPublicKey: recipientPub,
      plaintext: new TextEncoder().encode("x"),
      aad: new TextEncoder().encode("aad-A"),
    });
    await expect(
      hpkeOpen({
        recipientPrivateKey: kp.privateKey,
        enc,
        ciphertext,
        aad: new TextEncoder().encode("aad-B"),
      }),
    ).rejects.toThrow();
  });

  it("exposes the fixed protocol info string", () => {
    expect(HPKE_INFO).toBe("fast.xyz/key-handover/v1");
  });
});
