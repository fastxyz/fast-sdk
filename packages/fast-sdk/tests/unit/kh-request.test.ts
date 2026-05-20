import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../../src/wallet/key-handover/crypto/base64url";
import {
  type AuthRequest,
  decodeRequest,
  encodeRequest,
} from "../../src/wallet/key-handover/protocol/request";

const validPub = encodeBase64Url(new Uint8Array(32).fill(7));

function makeData(json: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(json)));
}

describe("protocol/request", () => {
  it("encodes then decodes preserving exact bytes", () => {
    const enc = encodeRequest({
      publicKey: new Uint8Array(32).fill(7),
      expiresAt: "2026-05-20T12:05:00Z",
      requester: "demo",
    });
    const decoded = decodeRequest(enc.data, () => new Date("2026-05-20T12:00:00Z"));
    expect(decoded.request.v).toBe(1);
    expect(decoded.request.requester).toBe("demo");
    expect(decoded.payloadBytes).toEqual(enc.payloadBytes);
  });

  it("treats omitted requester as empty string", () => {
    const data = makeData({ v: 1, exp: "2026-05-20T12:05:00Z", public_key: validPub });
    const decoded = decodeRequest(data, () => new Date("2026-05-20T12:00:00Z"));
    expect(decoded.request.requester).toBe("");
  });

  it("rejects v != 1", () => {
    const data = makeData({ v: 2, exp: "2026-05-20T12:05:00Z", public_key: validPub });
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:00:00Z"))).toThrow();
  });

  it("rejects unknown fields", () => {
    const data = makeData({ v: 1, exp: "2026-05-20T12:05:00Z", public_key: validPub, extra: 1 });
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:00:00Z"))).toThrow();
  });

  it("rejects duplicate keys", () => {
    const raw = '{"v":1,"v":1,"exp":"2026-05-20T12:05:00Z","public_key":"' + validPub + '"}';
    const data = encodeBase64Url(new TextEncoder().encode(raw));
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:00:00Z"))).toThrow();
  });

  it("rejects public_key not 32 bytes", () => {
    const shortPub = encodeBase64Url(new Uint8Array(16));
    const data = makeData({ v: 1, exp: "2026-05-20T12:05:00Z", public_key: shortPub });
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:00:00Z"))).toThrow();
  });

  it("rejects malformed exp timestamp", () => {
    const data = makeData({ v: 1, exp: "2026-05-20 12:05:00", public_key: validPub });
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:00:00Z"))).toThrow();
  });

  it("rejects expired window (now >= exp)", () => {
    const data = makeData({ v: 1, exp: "2026-05-20T12:05:00Z", public_key: validPub });
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:05:00Z"))).toThrow();
  });

  it("rejects window beyond now + 5 minutes", () => {
    const data = makeData({ v: 1, exp: "2026-05-20T12:10:01Z", public_key: validPub });
    expect(() => decodeRequest(data, () => new Date("2026-05-20T12:05:00Z"))).toThrow();
  });
});
