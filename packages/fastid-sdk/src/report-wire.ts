import {
  Aes256Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from "@hpke/core";

import { toHex } from "./address.js";
import { hexToBytes } from "./verify.js";

export const HPKE_SUITE =
  "DhkemX25519HkdfSha256/HkdfSha256/Aes256Gcm";
export const HPKE_INFO = "fast.xyz/key-handover/v1";
export const REPORT_AAD_DOMAIN = "fastid-report-aad-v1";
export const REPORT_SIGNATURE_DOMAIN = "fastid-report-sig-v1";

export interface ReportRecipient {
  key_id: string;
  public_key: string;
}

export interface WireSeal {
  recipient_key_id: string;
  enc: string;
  ciphertext: string;
}

export type WireAttribution =
  | "anonymous"
  | { signed: { signer_addr: string; signature: string } };

export interface WireEnvelope {
  v: 1;
  area: string;
  received_hour: string;
  seals: WireSeal[];
  attribution: WireAttribution;
}

const INFO_BYTES = new TextEncoder().encode(HPKE_INFO);

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

async function hpkeSeal(input: {
  recipientPublicKey: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
}): Promise<{ enc: Uint8Array; ciphertext: Uint8Array }> {
  const cipher = suite();
  const recipientPublicKey = await cipher.kem.deserializePublicKey(
    input.recipientPublicKey.slice().buffer as ArrayBuffer,
  );
  const sender = await cipher.createSenderContext({
    recipientPublicKey,
    info: INFO_BYTES,
  });
  const ciphertext = await sender.seal(
    input.plaintext.slice().buffer as ArrayBuffer,
    input.aad.slice().buffer as ArrayBuffer,
  );
  return {
    enc: new Uint8Array(sender.enc),
    ciphertext: new Uint8Array(ciphertext),
  };
}

export function formatReceivedHour(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T${pad(at.getUTCHours())}:00:00Z`;
}

export function hourUnixSecs(receivedHour: string): number {
  const milliseconds = Date.parse(receivedHour);
  if (!Number.isFinite(milliseconds)) throw new Error("not a canonical hour string");
  return milliseconds / 1000;
}

export function reportAad(area: string, receivedHour: string): Uint8Array {
  return new TextEncoder().encode(
    `${REPORT_AAD_DOMAIN}|${area}|${receivedHour}`,
  );
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function i64be(value: number): Uint8Array {
  const output = new Uint8Array(8);
  let remaining = BigInt.asUintN(64, BigInt(value));
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

/** Frozen attribution message over the exact area, hour, and seals. */
export function attributionMessage(
  area: string,
  hourUnix: number,
  seals: readonly WireSeal[],
): Uint8Array {
  const encoder = new TextEncoder();
  const areaBytes = encoder.encode(area);
  if (areaBytes.length > 0xff) throw new Error("area too long");
  if (seals.length > 0xff) throw new Error("too many seals");
  const parts: Uint8Array[] = [
    encoder.encode(REPORT_SIGNATURE_DOMAIN),
    Uint8Array.of(areaBytes.length),
    areaBytes,
    i64be(hourUnix),
    Uint8Array.of(seals.length),
  ];
  for (const seal of seals) {
    const keyId = encoder.encode(seal.recipient_key_id);
    if (keyId.length > 0xff) throw new Error("recipient_key_id too long");
    const encapsulated = hexToBytes(seal.enc);
    const ciphertext = hexToBytes(seal.ciphertext);
    parts.push(
      Uint8Array.of(keyId.length),
      keyId,
      u32be(encapsulated.length),
      encapsulated,
      u32be(ciphertext.length),
      ciphertext,
    );
  }
  return concatBytes(...parts);
}

export async function sealToRecipients(
  recipients: readonly ReportRecipient[],
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<WireSeal[]> {
  if (recipients.length === 0) throw new Error("no recipient keys; cannot seal");
  const seals: WireSeal[] = [];
  for (const recipient of recipients) {
    const sealed = await hpkeSeal({
      recipientPublicKey: hexToBytes(recipient.public_key),
      plaintext,
      aad,
    });
    seals.push({
      recipient_key_id: recipient.key_id,
      enc: toHex(sealed.enc),
      ciphertext: toHex(sealed.ciphertext),
    });
  }
  return seals;
}

export function anonymousEnvelope(
  area: string,
  receivedHour: string,
  seals: WireSeal[],
): WireEnvelope {
  return {
    v: 1,
    area,
    received_hour: receivedHour,
    seals,
    attribution: "anonymous",
  };
}

export function signedEnvelope(
  area: string,
  receivedHour: string,
  seals: WireSeal[],
  signerAddrHex: string,
  signatureHex: string,
): WireEnvelope {
  return {
    v: 1,
    area,
    received_hour: receivedHour,
    seals,
    attribution: {
      signed: { signer_addr: signerAddrHex, signature: signatureHex },
    },
  };
}
