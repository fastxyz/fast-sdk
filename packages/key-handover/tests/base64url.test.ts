import { describe, expect, it } from "vitest";
import {
  encodeBase64Url,
  decodeBase64Url,
} from "../src/crypto/base64url.ts";

describe("base64url", () => {
  it("round-trips arbitrary bytes unpadded", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(decodeBase64Url(encoded)).toEqual(bytes);
  });

  it("encodes empty input as empty string", () => {
    expect(encodeBase64Url(new Uint8Array([]))).toBe("");
    expect(decodeBase64Url("")).toEqual(new Uint8Array([]));
  });

  it("rejects padded input", () => {
    expect(() => decodeBase64Url("YQ==")).toThrow();
  });

  it("rejects standard base64 alphabet (+ and /)", () => {
    expect(() => decodeBase64Url("a+b/")).toThrow();
  });

  it("rejects whitespace and non-alphabet characters", () => {
    expect(() => decodeBase64Url("ab c")).toThrow();
    expect(() => decodeBase64Url("ab.c")).toThrow();
  });

  it("matches a known vector", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(encodeBase64Url(bytes)).toBe("aGVsbG8");
    expect(decodeBase64Url("aGVsbG8")).toEqual(bytes);
  });
});
