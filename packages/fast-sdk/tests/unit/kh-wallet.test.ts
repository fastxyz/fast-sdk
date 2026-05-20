import { describe, expect, it } from "vitest";
import {
  exportRecipientPublicKey,
  generateKeyPair,
} from "../../src/wallet/key-handover/crypto/hpke";
import { fingerprint } from "../../src/wallet/key-handover/crypto/fingerprint";
import { encodeRequest } from "../../src/wallet/key-handover/protocol/request";
import { decodeHandoverCode } from "../../src/wallet/key-handover/protocol/handover";
import { hpkeOpen } from "../../src/wallet/key-handover/crypto/hpke";
import { decodePlaintextSeed } from "../../src/wallet/key-handover/protocol/plaintext";
import { parseAuthRequest, sealHandover } from "../../src/wallet/key-handover/wallet";

const now = () => new Date("2026-05-20T12:00:00Z");

async function buildAuthUrl() {
  const kp = await generateKeyPair();
  const pub = await exportRecipientPublicKey(kp.publicKey);
  const { data, payloadBytes } = encodeRequest({
    publicKey: pub,
    expiresAt: "2026-05-20T12:05:00Z",
    requester: "demo agent",
  });
  return {
    url: `https://app.fast.xyz/authorize?data=${data}`,
    kp,
    payloadBytes,
  };
}

describe("wallet", () => {
  it("parses fingerprint, expiry and requester from auth url", async () => {
    const { url, payloadBytes } = await buildAuthUrl();
    const parsed = parseAuthRequest(url, now);
    expect(parsed.request_fingerprint).toBe(fingerprint(payloadBytes));
    expect(parsed.request_expires_at).toBe("2026-05-20T12:05:00Z");
    expect(parsed.requester).toBe("demo agent");
  });

  it("seals a seed that the request key can open with request bytes as AAD", async () => {
    const { url, kp, payloadBytes } = await buildAuthUrl();
    const seed = new Uint8Array(32).fill(11);
    const sealed = await sealHandover({ authUrlOrData: url, seed, now });
    expect(sealed.request_fingerprint).toBe(fingerprint(payloadBytes));
    expect(sealed.chat_message).toContain(`"${sealed.handover_code}"`);

    const { enc, ciphertext } = decodeHandoverCode(sealed.handover_code);
    const opened = await hpkeOpen({
      recipientPrivateKey: kp.privateKey,
      enc,
      ciphertext,
      aad: payloadBytes,
    });
    expect(decodePlaintextSeed(opened)).toEqual(seed);
  });
});
