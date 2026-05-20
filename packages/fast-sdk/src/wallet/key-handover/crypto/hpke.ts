import {
  Aes256Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from "@hpke/core";

export const HPKE_INFO = "fast.xyz/key-handover/v1";

const INFO_BYTES = new TextEncoder().encode(HPKE_INFO);

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

export interface HpkeKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateKeyPair(): Promise<HpkeKeyPair> {
  const kp = await suite().kem.generateKeyPair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function exportRecipientPublicKey(
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const raw = await suite().kem.serializePublicKey(publicKey);
  return new Uint8Array(raw);
}

export async function hpkeSeal(input: {
  recipientPublicKey: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
}): Promise<{ enc: Uint8Array; ciphertext: Uint8Array }> {
  const s = suite();
  const recipientKey = await s.kem.deserializePublicKey(
    input.recipientPublicKey.slice().buffer,
  );
  const sender = await s.createSenderContext({
    recipientPublicKey: recipientKey,
    info: INFO_BYTES,
  });
  const ciphertext = await sender.seal(input.plaintext, input.aad);
  return {
    enc: new Uint8Array(sender.enc),
    ciphertext: new Uint8Array(ciphertext),
  };
}

export async function hpkeOpen(input: {
  recipientPrivateKey: CryptoKey;
  enc: Uint8Array;
  ciphertext: Uint8Array;
  aad: Uint8Array;
}): Promise<Uint8Array> {
  const s = suite();
  const recipient = await s.createRecipientContext({
    recipientKey: input.recipientPrivateKey,
    enc: input.enc.slice().buffer,
    info: INFO_BYTES,
  });
  const plaintext = await recipient.open(input.ciphertext, input.aad);
  return new Uint8Array(plaintext);
}
