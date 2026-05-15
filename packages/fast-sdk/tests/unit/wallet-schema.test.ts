import { describe, expect, it } from "vitest";
import {
  parseConnectRequestEnvelope,
  parseResultMsg,
  parseSignRequestEnvelope,
} from "../../src/wallet/schema";

const VALID_CONNECT_ENVELOPE = {
  dappOrigin: "https://my-dapp.com",
  metadata: {
    name: "My Dapp",
    origin: "https://my-dapp.com",
    icon: "https://my-dapp.com/icon.png",
  },
};

const VALID_ENVELOPE = {
  dappOrigin: "https://my-dapp.com",
  bytes: [1, 2, 3, 255, 0],
  metadata: {
    name: "My Dapp",
    origin: "https://my-dapp.com",
    icon: "https://my-dapp.com/icon.png",
  },
};

describe("parseSignRequestEnvelope", () => {
  it("accepts a valid envelope", () => {
    const parsed = parseSignRequestEnvelope(VALID_ENVELOPE);
    expect(parsed.dappOrigin).toBe("https://my-dapp.com");
    expect(parsed.bytes).toEqual([1, 2, 3, 255, 0]);
  });

  it("accepts an envelope without metadata", () => {
    const parsed = parseSignRequestEnvelope({
      dappOrigin: "https://my-dapp.com",
      bytes: [1, 2, 3],
    });
    expect(parsed.metadata).toBeUndefined();
  });

  it("rejects a byte value outside 0-255", () => {
    expect(() =>
      parseSignRequestEnvelope({ ...VALID_ENVELOPE, bytes: [1, 256] }),
    ).toThrow();
  });

  it("rejects a non-integer byte value", () => {
    expect(() =>
      parseSignRequestEnvelope({ ...VALID_ENVELOPE, bytes: [1, 2.5] }),
    ).toThrow();
  });

  it("rejects bytes longer than 8192", () => {
    expect(() =>
      parseSignRequestEnvelope({
        ...VALID_ENVELOPE,
        bytes: new Array(8193).fill(0),
      }),
    ).toThrow();
  });

  it("rejects a non-http(s) dappOrigin", () => {
    expect(() =>
      parseSignRequestEnvelope({
        ...VALID_ENVELOPE,
        dappOrigin: "ftp://my-dapp.com",
        metadata: { ...VALID_ENVELOPE.metadata, origin: "ftp://my-dapp.com" },
      }),
    ).toThrow();
  });

  it("rejects a malformed dappOrigin", () => {
    expect(() =>
      parseSignRequestEnvelope({
        ...VALID_ENVELOPE,
        dappOrigin: "not a url",
        metadata: { ...VALID_ENVELOPE.metadata, origin: "not a url" },
      }),
    ).toThrow();
  });

  it("rejects when metadata.origin !== dappOrigin", () => {
    expect(() =>
      parseSignRequestEnvelope({
        ...VALID_ENVELOPE,
        metadata: { ...VALID_ENVELOPE.metadata, origin: "https://evil.com" },
      }),
    ).toThrow();
  });

  it("rejects unknown extra fields", () => {
    expect(() =>
      parseSignRequestEnvelope({ ...VALID_ENVELOPE, extra: "nope" }),
    ).toThrow();
  });
});

describe("parseConnectRequestEnvelope", () => {
  it("accepts a valid envelope", () => {
    const parsed = parseConnectRequestEnvelope(VALID_CONNECT_ENVELOPE);
    expect(parsed.dappOrigin).toBe("https://my-dapp.com");
    expect(parsed.metadata?.name).toBe("My Dapp");
  });

  it("accepts an envelope without metadata", () => {
    const parsed = parseConnectRequestEnvelope({
      dappOrigin: "https://my-dapp.com",
    });
    expect(parsed.metadata).toBeUndefined();
  });

  it("rejects a non-http(s) dappOrigin", () => {
    expect(() =>
      parseConnectRequestEnvelope({
        ...VALID_CONNECT_ENVELOPE,
        dappOrigin: "ftp://my-dapp.com",
        metadata: {
          ...VALID_CONNECT_ENVELOPE.metadata,
          origin: "ftp://my-dapp.com",
        },
      }),
    ).toThrow();
  });

  it("rejects a malformed dappOrigin", () => {
    expect(() =>
      parseConnectRequestEnvelope({
        ...VALID_CONNECT_ENVELOPE,
        dappOrigin: "not a url",
        metadata: { ...VALID_CONNECT_ENVELOPE.metadata, origin: "not a url" },
      }),
    ).toThrow();
  });

  it("rejects when metadata.origin !== dappOrigin", () => {
    expect(() =>
      parseConnectRequestEnvelope({
        ...VALID_CONNECT_ENVELOPE,
        metadata: {
          ...VALID_CONNECT_ENVELOPE.metadata,
          origin: "https://evil.com",
        },
      }),
    ).toThrow();
  });

  it("rejects unknown extra fields", () => {
    expect(() =>
      parseConnectRequestEnvelope({
        ...VALID_CONNECT_ENVELOPE,
        bytes: [1, 2, 3],
      }),
    ).toThrow();
  });
});

describe("parseResultMsg", () => {
  it("accepts a sign-shape success result", () => {
    const msg = parseResultMsg({
      t: "fast-popup-result",
      ok: true,
      result: { signature: "a".repeat(128) },
    });
    expect(msg.ok).toBe(true);
  });

  it("accepts a connect-shape success result", () => {
    const msg = parseResultMsg({
      t: "fast-popup-result",
      ok: true,
      result: {
        address: "fast1qpgs56s3rvfwakjl5gs5lwlnq5pmrkdjj8h27qchx9",
      },
    });
    expect(msg.ok).toBe(true);
  });

  it("rejects an address that doesn't match the bech32 pattern", () => {
    expect(() =>
      parseResultMsg({
        t: "fast-popup-result",
        ok: true,
        result: { address: "0xnotfast" },
      }),
    ).toThrow();
  });

  it("accepts a failure result", () => {
    const msg = parseResultMsg({
      t: "fast-popup-result",
      ok: false,
      error: { code: "user_rejected", message: "no" },
    });
    expect(msg.ok).toBe(false);
  });

  it("rejects a signature that is not 128 hex chars", () => {
    expect(() =>
      parseResultMsg({
        t: "fast-popup-result",
        ok: true,
        result: { signature: "abc" },
      }),
    ).toThrow();
  });

  it("rejects an unknown error code", () => {
    expect(() =>
      parseResultMsg({
        t: "fast-popup-result",
        ok: false,
        error: { code: "made_up", message: "x" },
      }),
    ).toThrow();
  });

  it("rejects a wrong message tag", () => {
    expect(() =>
      parseResultMsg({
        t: "something-else",
        ok: true,
        result: { signature: "a".repeat(128) },
      }),
    ).toThrow();
  });
});
