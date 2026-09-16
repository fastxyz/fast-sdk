import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";

/** Noble v2 requires SHA-512 wiring for every synchronous signing operation. */
export function ensureEd25519Sync(): void {
  if (typeof ed.etc.sha512Sync !== "function") {
    ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
      sha512(ed.etc.concatBytes(...messages));
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    throw new Error("bad hex");
  }
  const output = new Uint8Array(clean.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

/** Strict Ed25519 verification matching dalek `verify_strict`. */
export function verifyStrict(
  message: Uint8Array,
  signatureHex: string,
  publicKey: Uint8Array,
): boolean {
  try {
    ensureEd25519Sync();
    const signature = hexToBytes(signatureHex);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return ed.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}
