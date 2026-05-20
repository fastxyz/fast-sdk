import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../src/crypto/base64url.ts";
import {
  decodeHandoverCode,
  encodeHandoverCode,
  extractSingleQuotedCandidate,
} from "../src/protocol/handover.ts";

const enc32 = new Uint8Array(32).fill(3);
const ct = new Uint8Array([9, 9, 9]);

function makeCode(): string {
  return encodeHandoverCode({ enc: enc32, ciphertext: ct });
}

describe("protocol/handover", () => {
  it("round-trips enc and ciphertext", () => {
    const code = makeCode();
    const decoded = decodeHandoverCode(code);
    expect(decoded.enc).toEqual(enc32);
    expect(decoded.ciphertext).toEqual(ct);
  });

  it("extracts exactly one quoted candidate", () => {
    const code = makeCode();
    const msg = `Here is the encrypted handover code. Use it to complete encrypted key handover: "${code}"`;
    expect(extractSingleQuotedCandidate(msg)).toBe(code);
  });

  it("rejects zero quoted candidates", () => {
    expect(() => extractSingleQuotedCandidate("no quotes here")).toThrow();
  });

  it("rejects multiple quoted candidates", () => {
    expect(() => extractSingleQuotedCandidate('"a" and "b"')).toThrow();
  });

  it("rejects enc that is not 32 bytes", () => {
    const bad = encodeBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          enc: encodeBase64Url(new Uint8Array(16)),
          ciphertext: encodeBase64Url(ct),
        }),
      ),
    );
    expect(() => decodeHandoverCode(bad)).toThrow();
  });

  it("rejects ciphertext over 4096 bytes", () => {
    const big = encodeBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          enc: encodeBase64Url(enc32),
          ciphertext: encodeBase64Url(new Uint8Array(4097)),
        }),
      ),
    );
    expect(() => decodeHandoverCode(big)).toThrow();
  });

  it("rejects unknown fields", () => {
    const bad = encodeBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          enc: encodeBase64Url(enc32),
          ciphertext: encodeBase64Url(ct),
          alg: "x",
        }),
      ),
    );
    expect(() => decodeHandoverCode(bad)).toThrow();
  });
});
