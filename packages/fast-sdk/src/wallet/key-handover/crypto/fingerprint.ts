import { sha256 } from "@noble/hashes/sha2.js";

export function fingerprint(requestPayloadBytes: Uint8Array): string {
  const digest = sha256(requestPayloadBytes);
  const value =
    (digest[0] * 0x1000000 +
      digest[1] * 0x10000 +
      digest[2] * 0x100 +
      digest[3]) %
    1_000_000;
  return value.toString().padStart(6, "0");
}
