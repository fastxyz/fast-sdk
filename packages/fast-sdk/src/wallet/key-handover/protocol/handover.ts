import { decodeBase64Url, encodeBase64Url } from "../crypto/base64url";
import { ERROR } from "../errors";
import { detectDuplicateKeys } from "./strict-json";

const MAX_CIPHERTEXT_BYTES = 4096;

export interface HandoverPayload {
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

export function extractSingleQuotedCandidate(message: string): string {
  const trimmed = message.trim();
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }
  const matches = trimmed.match(/"([^"]*)"/g);
  if (!matches || matches.length !== 1) {
    throw new Error(
      `${ERROR.MALFORMED_HANDOVER_MESSAGE}: expected exactly one quoted candidate`,
    );
  }
  return matches[0].slice(1, -1);
}

export function encodeHandoverCode(payload: HandoverPayload): string {
  const json = JSON.stringify({
    enc: encodeBase64Url(payload.enc),
    ciphertext: encodeBase64Url(payload.ciphertext),
  });
  return encodeBase64Url(new TextEncoder().encode(json));
}

export function decodeHandoverCode(code: string): HandoverPayload {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(code);
  } catch {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: malformed base64url`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: non-utf8`);
  }

  detectDuplicateKeys(text);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: invalid JSON`);
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: non-object`);
  }
  const record = obj as Record<string, unknown>;
  const allowed = new Set(["enc", "ciphertext"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: unknown field ${key}`);
    }
  }
  if (typeof record.enc !== "string" || typeof record.ciphertext !== "string") {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: missing enc/ciphertext`);
  }

  const enc = decodeBase64Url(record.enc);
  if (enc.length !== 32) {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: enc must be 32 bytes`);
  }
  const ciphertext = decodeBase64Url(record.ciphertext);
  if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: ciphertext too large`);
  }
  return { enc, ciphertext };
}
