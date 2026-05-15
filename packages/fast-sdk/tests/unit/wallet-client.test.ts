import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { FastWalletError } from "../../src/wallet/errors";
import { FastWalletClient } from "../../src/wallet/client";
import type { ResultMsg } from "../../src/wallet/types";

describe("FastWalletError", () => {
  it("carries code and message, and is an Error", () => {
    const err = new FastWalletError("user_rejected", "user said no");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FastWalletError);
    expect(err.code).toBe("user_rejected");
    expect(err.message).toBe("user said no");
    expect(err.name).toBe("FastWalletError");
  });
});

const POPUP_URL = "https://app.fast.xyz/wallet/sign";
const POPUP_ORIGIN = new URL(POPUP_URL).origin;
const DAPP_ORIGIN = "https://my-dapp.com";

interface FakePopup {
  closed: boolean;
  close: Mock<() => void>;
}

/** A controlled fake window for driving all client code paths. */
function makeFakeWindow() {
  const listeners: Array<(ev: unknown) => void> = [];
  const popups: FakePopup[] = [];
  let lastOpenUrl: string | null = null;
  let openReturnsNull = false;

  /** Each open() creates a new popup, mirroring real browser behavior. */
  function makePopup(): FakePopup {
    const popup: FakePopup = {
      closed: false,
      close: vi.fn<() => void>(() => {
        popup.closed = true;
      }),
    };
    popups.push(popup);
    return popup;
  }

  const windowRef = {
    location: { origin: DAPP_ORIGIN },
    open: vi.fn((url: string) => {
      lastOpenUrl = url;
      return openReturnsNull ? null : makePopup();
    }),
    addEventListener: vi.fn((_type: string, l: (ev: unknown) => void) => {
      listeners.push(l);
    }),
    removeEventListener: vi.fn((_type: string, l: (ev: unknown) => void) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    }),
  };

  /**
   * Simulate a postMessage. `source` defaults to the most recently opened popup;
   * `origin` defaults to POPUP_ORIGIN.
   */
  function emitMessage(opts: {
    source?: unknown;
    origin?: string;
    data: unknown;
  }) {
    const ev = {
      source: "source" in opts ? opts.source : popups[popups.length - 1],
      origin: opts.origin ?? POPUP_ORIGIN,
      data: opts.data,
    };
    for (const l of [...listeners]) l(ev);
  }

  return {
    windowRef,
    emitMessage,
    /** Most recently opened popup. */
    get lastPopup(): FakePopup {
      return popups[popups.length - 1]!;
    },
    get lastOpenUrl() {
      return lastOpenUrl;
    },
    get listenerCount() {
      return listeners.length;
    },
    setOpenReturnsNull(v: boolean) {
      openReturnsNull = v;
    },
  };
}

const okMsg: ResultMsg = {
  t: "fast-popup-result",
  ok: true,
  result: { signature: "a".repeat(128) },
};

describe("FastWalletClient.sign", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a popup with the encoded envelope in the URL and resolves on success", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    const promise = client.sign({ bytes: [1, 2, 3] });

    expect(fake.windowRef.open).toHaveBeenCalledTimes(1);
    expect(fake.lastOpenUrl?.startsWith(`${POPUP_URL}?tx=`)).toBe(true);

    fake.emitMessage({ data: okMsg });
    await expect(promise).resolves.toEqual({ signature: "a".repeat(128) });
    expect(fake.listenerCount).toBe(0); // listener cleaned up
  });

  it("rejects with the popup's error code on a failure result", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    const promise = client.sign({ bytes: [1, 2, 3] });
    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: false,
        error: { code: "user_rejected", message: "user said no" },
      },
    });

    await expect(promise).rejects.toMatchObject({
      name: "FastWalletError",
      code: "user_rejected",
    });
  });

  it("rejects with user_cancelled when the popup is closed", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    const promise = client.sign({ bytes: [1, 2, 3] });
    // Attach rejection handler before advancing timers to avoid unhandled rejection warning.
    const result = expect(promise).rejects.toMatchObject({ code: "user_cancelled" });
    fake.lastPopup.closed = true;
    await vi.advanceTimersByTimeAsync(600); // advance past the 500ms poll interval
    await result;
  });

  it("rejects with timeout and closes the popup after timeoutMs", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
      timeoutMs: 1000,
    });

    const promise = client.sign({ bytes: [1, 2, 3] });
    // Attach rejection handler before advancing timers to avoid unhandled rejection warning.
    const result = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1100);
    await result;
    expect(fake.lastPopup.close).toHaveBeenCalled();
  });

  it("throws popup_blocked when window.open returns null", async () => {
    const fake = makeFakeWindow();
    fake.setOpenReturnsNull(true);
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    await expect(client.sign({ bytes: [1, 2, 3] })).rejects.toMatchObject({
      code: "popup_blocked",
    });
  });

  it("throws invalid_payload for an out-of-range byte and never opens a popup", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    await expect(client.sign({ bytes: [1, 999] })).rejects.toMatchObject({
      code: "invalid_payload",
    });
    expect(fake.windowRef.open).not.toHaveBeenCalled();
  });

  it("throws url_too_large when bytes make the URL exceed the limit", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    // 8192 bytes is within the schema limit but base64url+JSON encoding pushes the URL past 16 KB.
    const bytes = new Array(8192).fill(255);
    await expect(client.sign({ bytes })).rejects.toMatchObject({
      code: "url_too_large",
    });
    expect(fake.windowRef.open).not.toHaveBeenCalled();
  });

  it("ignores messages from the wrong origin", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    const promise = client.sign({ bytes: [1, 2, 3] });
    fake.emitMessage({ origin: "https://evil.com", data: okMsg });

    // Message from wrong origin is ignored — promise stays pending; settle via timeout.
    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    // Only a message from the correct origin settles the promise.
    fake.emitMessage({ data: okMsg });
    await expect(promise).resolves.toEqual({ signature: "a".repeat(128) });
  });

  it("ignores messages from a source other than the popup window", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    const promise = client.sign({ bytes: [1, 2, 3] });
    fake.emitMessage({ source: { not: "the popup" }, data: okMsg });

    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    fake.emitMessage({ data: okMsg });
    await expect(promise).resolves.toEqual({ signature: "a".repeat(128) });
  });

  it("cancels a previous in-flight sign() when a new one starts", async () => {
    const fake = makeFakeWindow();
    const client = new FastWalletClient({
      popupUrl: POPUP_URL,
      windowRef: fake.windowRef,
    });

    const first = client.sign({ bytes: [1] });
    const second = client.sign({ bytes: [2] });

    await expect(first).rejects.toMatchObject({ code: "user_cancelled" });
    // After first rejects, its listener must have been removed — only second's listener remains.
    expect(fake.listenerCount).toBe(1);
    fake.emitMessage({ data: okMsg });
    await expect(second).resolves.toEqual({ signature: "a".repeat(128) });
  });
});
