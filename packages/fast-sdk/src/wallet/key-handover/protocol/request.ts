import { decodeBase64Url, encodeBase64Url } from "../crypto/base64url";
import { ERROR } from "../errors";
import { detectDuplicateKeys } from "./strict-json";

const EXP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface AuthRequest {
  v: 1;
  exp: string;
  public_key: string;
  requester: string;
}

export interface DecodedRequest {
  request: AuthRequest;
  publicKey: Uint8Array;
  payloadBytes: Uint8Array;
}

function parseStrictObject(text: string): Record<string, unknown> {
  detectDuplicateKeys(text);
  const value = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: non-object JSON`);
  }
  return value as Record<string, unknown>;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeRequest(input: {
  publicKey: Uint8Array;
  expiresAt: string;
  requester?: string;
}): { data: string; payloadBytes: Uint8Array; request: AuthRequest } {
  const request: AuthRequest = {
    v: 1,
    exp: input.expiresAt,
    public_key: encodeBase64Url(input.publicKey),
    requester: input.requester ?? "",
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(request));
  return { data: encodeBase64Url(payloadBytes), payloadBytes, request };
}

export function decodeRequest(
  data: string,
  now: () => Date = () => new Date(),
): DecodedRequest {
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = decodeBase64Url(data);
  } catch {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: malformed base64url data`);
  }
  let text: string;
  try {
    text = decodeUtf8(payloadBytes);
  } catch {
    throw new Error(`${ERROR.INVALID_HANDOVER_CODE}: non-utf8 request`);
  }

  const obj = parseStrictObject(text);
  const allowed = new Set(["v", "exp", "public_key", "requester"]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new Error(`unknown field: ${key}`);
  }
  if (obj.v !== 1) throw new Error("unsupported version");
  if (typeof obj.exp !== "string" || !EXP_REGEX.test(obj.exp)) {
    throw new Error("invalid exp timestamp");
  }
  if (typeof obj.public_key !== "string") {
    throw new Error("invalid public_key type");
  }
  if (obj.requester !== undefined && typeof obj.requester !== "string") {
    throw new Error("invalid requester type");
  }

  const publicKey = decodeBase64Url(obj.public_key);
  if (publicKey.length !== 32) throw new Error("public_key must be 32 bytes");

  const expMs = Date.parse(obj.exp);
  if (Number.isNaN(expMs)) throw new Error("unparseable exp");
  const nowMs = now().getTime();
  if (!(nowMs < expMs && expMs <= nowMs + FIVE_MINUTES_MS)) {
    throw new Error(`${ERROR.REQUEST_EXPIRED}: exp outside valid window`);
  }

  const request: AuthRequest = {
    v: 1,
    exp: obj.exp,
    public_key: obj.public_key,
    requester: typeof obj.requester === "string" ? obj.requester : "",
  };
  return { request, publicKey, payloadBytes };
}
