import { describe, expect, it } from "vitest";
import {
  exportRecipientPublicKey,
  generateKeyPair,
} from "../../src/wallet/key-handover/crypto/hpke";
import { fingerprint } from "../../src/wallet/key-handover/crypto/fingerprint";
import { decodeRequest, encodeRequest } from "../../src/wallet/key-handover/protocol/request";
import { parseAuthRequest } from "../../src/wallet/key-handover/wallet";

const now = () => new Date("2026-05-20T12:00:00Z");

describe("byte-exact invariants", () => {
  it("encode→decode preserves payload bytes and fingerprint", async () => {
    const pub = await exportRecipientPublicKey((await generateKeyPair()).publicKey);
    const enc = encodeRequest({
      publicKey: pub,
      expiresAt: "2026-05-20T12:05:00Z",
      requester: "label with spaces and 漢字",
    });
    const decoded = decodeRequest(enc.data, now);
    expect(decoded.payloadBytes).toEqual(enc.payloadBytes);
    expect(fingerprint(decoded.payloadBytes)).toBe(fingerprint(enc.payloadBytes));
  });

  it("wallet parse yields the same bytes the agent fingerprinted", async () => {
    const pub = await exportRecipientPublicKey((await generateKeyPair()).publicKey);
    const enc = encodeRequest({
      publicKey: pub,
      expiresAt: "2026-05-20T12:05:00Z",
      requester: "demo",
    });
    const parsed = parseAuthRequest(`https://x/authorize?data=${enc.data}`, now);
    expect(parsed.payloadBytes).toEqual(enc.payloadBytes);
    expect(parsed.request_fingerprint).toBe(fingerprint(enc.payloadBytes));
  });
});
