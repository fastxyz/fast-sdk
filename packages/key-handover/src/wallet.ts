import { fingerprint } from "./crypto/fingerprint.ts";
import { hpkeSeal } from "./crypto/hpke.ts";
import { encodeHandoverCode } from "./protocol/handover.ts";
import { encodePlaintextSeed } from "./protocol/plaintext.ts";
import { decodeRequest } from "./protocol/request.ts";

function extractData(authUrlOrData: string): string {
  const trimmed = authUrlOrData.trim();
  if (trimmed.includes("?")) {
    const url = new URL(trimmed);
    const data = url.searchParams.get("data");
    if (!data) throw new Error("missing data parameter");
    return data;
  }
  return trimmed;
}

export interface ParsedAuthRequest {
  request_fingerprint: string;
  request_expires_at: string;
  requester: string;
  payloadBytes: Uint8Array;
  publicKey: Uint8Array;
}

export function parseAuthRequest(
  authUrlOrData: string,
  now: () => Date = () => new Date(),
): ParsedAuthRequest {
  const data = extractData(authUrlOrData);
  const decoded = decodeRequest(data, now);
  return {
    request_fingerprint: fingerprint(decoded.payloadBytes),
    request_expires_at: decoded.request.exp,
    requester: decoded.request.requester,
    payloadBytes: decoded.payloadBytes,
    publicKey: decoded.publicKey,
  };
}

export async function sealHandover(input: {
  authUrlOrData: string;
  seed: Uint8Array;
  now?: () => Date;
}): Promise<{
  handover_code: string;
  chat_message: string;
  request_fingerprint: string;
}> {
  const parsed = parseAuthRequest(input.authUrlOrData, input.now);
  const plaintext = encodePlaintextSeed(input.seed);
  const { enc, ciphertext } = await hpkeSeal({
    recipientPublicKey: parsed.publicKey,
    plaintext,
    aad: parsed.payloadBytes,
  });
  const handover_code = encodeHandoverCode({ enc, ciphertext });
  return {
    handover_code,
    chat_message: `Here is the encrypted handover code. Use it to complete encrypted key handover: "${handover_code}"`,
    request_fingerprint: parsed.request_fingerprint,
  };
}
