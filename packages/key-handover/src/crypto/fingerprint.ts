import { sha256 } from "@noble/hashes/sha2.js";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function fingerprint(requestPayloadBytes: Uint8Array): string {
  const digest = sha256(requestPayloadBytes);
  const first5 = digest.slice(0, 5);
  let bits = 0n;
  for (const b of first5) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 7; i >= 0; i--) {
    const shift = BigInt(i * 5);
    out += CROCKFORD_ALPHABET[Number((bits >> shift) & 31n)];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}
