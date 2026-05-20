import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "../src/crypto/base64url.ts";
import {
  decodePlaintextSeed,
  encodePlaintextSeed,
} from "../src/protocol/plaintext.ts";

const seed = new Uint8Array(32).fill(5);

describe("protocol/plaintext", () => {
  it("round-trips a 32-byte seed", () => {
    const bytes = encodePlaintextSeed(seed);
    expect(decodePlaintextSeed(bytes)).toEqual(seed);
  });

  it("rejects a seed that is not 32 bytes", () => {
    const json = JSON.stringify({ private_key: encodeBase64Url(new Uint8Array(16)) });
    const bytes = new TextEncoder().encode(json);
    expect(() => decodePlaintextSeed(bytes)).toThrow();
  });

  it("rejects unknown fields", () => {
    const json = JSON.stringify({
      private_key: encodeBase64Url(seed),
      extra: 1,
    });
    expect(() => decodePlaintextSeed(new TextEncoder().encode(json))).toThrow();
  });

  it("rejects missing private_key", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({}));
    expect(() => decodePlaintextSeed(bytes)).toThrow();
  });

  it("rejects duplicate keys", () => {
    const pk = encodeBase64Url(seed);
    const raw = `{"private_key":"${pk}","private_key":"${pk}"}`;
    expect(() => decodePlaintextSeed(new TextEncoder().encode(raw))).toThrow();
  });
});
