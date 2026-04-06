import { describe, expect, it } from "vitest";
import {
  bigintFromHex,
  bigintToHex,
  fromFastAddress,
  fromHex,
  toFastAddress,
  toHex,
} from "../../src/index";

describe("toHex / fromHex", () => {
  it("round-trips bytes through hex", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const hex = toHex(bytes);
    expect(hex).toMatch(/^0x[0-9a-f]+$/);
    expect(fromHex(hex)).toEqual(bytes);
  });

  it("toHex returns 0x-prefixed lowercase hex", () => {
    const bytes = new Uint8Array([0xab, 0xcd]);
    expect(toHex(bytes)).toBe("0xabcd");
  });

  it("fromHex handles 0x prefix", () => {
    expect(fromHex("0xabcd")).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it("fromHex handles 0X prefix", () => {
    expect(fromHex("0Xabcd")).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it("fromHex handles bare hex (no prefix)", () => {
    expect(fromHex("abcd")).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it("fromHex throws on invalid hex", () => {
    expect(() => fromHex("0xZZZZ")).toThrow();
  });

  it("handles empty bytes", () => {
    const bytes = new Uint8Array(0);
    expect(toHex(bytes)).toBe("0x");
    expect(fromHex("0x")).toEqual(bytes);
  });

  it("handles 32-byte key", () => {
    const bytes = new Uint8Array(32).fill(0xff);
    const hex = toHex(bytes);
    expect(hex).toBe("0x" + "ff".repeat(32));
    expect(fromHex(hex)).toEqual(bytes);
  });
});

describe("toFastAddress / fromFastAddress", () => {
  it("round-trips bytes through bech32m address", () => {
    const bytes = new Uint8Array(32).fill(1);
    const address = toFastAddress(bytes);
    expect(address).toMatch(/^fast1/);
    expect(fromFastAddress(address)).toEqual(bytes);
  });

  it("produces different addresses for different keys", () => {
    const a = toFastAddress(new Uint8Array(32).fill(1));
    const b = toFastAddress(new Uint8Array(32).fill(2));
    expect(a).not.toBe(b);
  });

  it("fromFastAddress rejects wrong prefix", () => {
    // Encode with a different bech32m prefix to test rejection
    expect(() =>
      fromFastAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
    ).toThrow();
  });

  it("fromFastAddress rejects garbage input", () => {
    expect(() => fromFastAddress("not-an-address")).toThrow();
  });
});

describe("bigintToHex / bigintFromHex", () => {
  it("round-trips bigint through hex", () => {
    const n = 123456789012345678901234567890n;
    expect(bigintFromHex(bigintToHex(n))).toBe(n);
  });

  it("bigintToHex returns 0x-prefixed hex", () => {
    expect(bigintToHex(255n)).toBe("0xff");
  });

  it("bigintToHex handles zero", () => {
    expect(bigintToHex(0n)).toBe("0x0");
  });

  it("bigintFromHex handles 0x prefix", () => {
    expect(bigintFromHex("0xff")).toBe(255n);
  });

  it("bigintFromHex handles 0X prefix", () => {
    expect(bigintFromHex("0Xff")).toBe(255n);
  });

  it("bigintFromHex handles bare hex", () => {
    expect(bigintFromHex("ff")).toBe(255n);
  });

  it("handles large values (u256 range)", () => {
    const max = (1n << 256n) - 1n;
    expect(bigintFromHex(bigintToHex(max))).toBe(max);
  });
});
