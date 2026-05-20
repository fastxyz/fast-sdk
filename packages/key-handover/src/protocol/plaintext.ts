import { decodeBase64Url, encodeBase64Url } from "../crypto/base64url.ts";
import { ERROR } from "../errors.ts";
import { detectDuplicateKeys } from "./strict-json.ts";

export function encodePlaintextSeed(seed: Uint8Array): Uint8Array {
  const json = JSON.stringify({ private_key: encodeBase64Url(seed) });
  return new TextEncoder().encode(json);
}

export function decodePlaintextSeed(plaintext: Uint8Array): Uint8Array {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error(`${ERROR.DECRYPTION_FAILED}: non-utf8 plaintext`);
  }
  detectDuplicateKeys(text);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(`${ERROR.DECRYPTION_FAILED}: invalid plaintext JSON`);
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error(`${ERROR.DECRYPTION_FAILED}: non-object plaintext`);
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "private_key") {
      throw new Error(`${ERROR.DECRYPTION_FAILED}: unknown field ${key}`);
    }
  }
  if (typeof record.private_key !== "string") {
    throw new Error(`${ERROR.DECRYPTION_FAILED}: missing private_key`);
  }
  const seed = decodeBase64Url(record.private_key);
  if (seed.length !== 32) {
    throw new Error(`${ERROR.DECRYPTION_FAILED}: seed must be 32 bytes`);
  }
  return seed;
}
