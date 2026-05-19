import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { FastWalletClient } from "../../src/wallet/client";
import { FastWalletError } from "../../src/wallet/errors";

const SIGN_URL = "https://app.fast.xyz/sign";
const CONNECT_URL = "https://app.fast.xyz/connect";
const POPUP_ORIGIN = new URL(CONNECT_URL).origin;
const DAPP_ORIGIN = "https://my-dapp.com";
const DEFAULT_STORAGE_KEY = "fastxyz:wallet:address";
const VALID_ADDRESS =
  "fast1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs93v4kv";
const TEST_METADATA = {
  name: "Test Dapp",
  origin: DAPP_ORIGIN,
};

interface FakePopup {
  closed: boolean;
  close: Mock<() => void>;
}

/** In-memory localStorage shim; `throwOn` simulates QuotaExceededError etc. */
function makeFakeLocalStorage(opts: {
  seed?: Record<string, string>;
  throwOn?: Set<"getItem" | "setItem" | "removeItem">;
} = {}) {
  const map = new Map(Object.entries(opts.seed ?? {}));
  const throwOn = opts.throwOn ?? new Set();
  return {
    getItem: vi.fn((k: string): string | null => {
      if (throwOn.has("getItem")) throw new Error("storage disabled");
      return map.get(k) ?? null;
    }),
    setItem: vi.fn((k: string, v: string): void => {
      if (throwOn.has("setItem")) throw new Error("storage disabled");
      map.set(k, v);
    }),
    removeItem: vi.fn((k: string): void => {
      if (throwOn.has("removeItem")) throw new Error("storage disabled");
      map.delete(k);
    }),
    /** Test-only escape hatch to inspect raw state. */
    get _map() { return map; },
  };
}

interface SetupOpts {
  initialStorage?: Record<string, string>;
  throwOn?: Set<"getItem" | "setItem" | "removeItem">;
  storageKey?: string;
  /** When true, omit localStorage from windowRef entirely. */
  noStorage?: boolean;
  /** When true, window.open returns null (popup blocked). */
  openReturnsNull?: boolean;
}

function setup(opts: SetupOpts = {}) {
  const storage = opts.noStorage
    ? undefined
    : makeFakeLocalStorage({
        seed: opts.initialStorage,
        throwOn: opts.throwOn,
      });

  const listeners: Array<(ev: unknown) => void> = [];
  const popups: FakePopup[] = [];
  let lastOpenUrl: string | null = null;

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
    localStorage: storage,
    open: vi.fn((url: string) => {
      lastOpenUrl = url;
      return opts.openReturnsNull ? null : makePopup();
    }),
    addEventListener: vi.fn((_type: string, l: (ev: unknown) => void) => {
      listeners.push(l);
    }),
    removeEventListener: vi.fn((_type: string, l: (ev: unknown) => void) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    }),
  };

  function emitMessage(o: {
    source?: unknown;
    origin?: string;
    data: unknown;
  }) {
    const ev = {
      source: "source" in o ? o.source : popups[popups.length - 1],
      origin: o.origin ?? POPUP_ORIGIN,
      data: o.data,
    };
    for (const l of [...listeners]) l(ev);
  }

  const client = new FastWalletClient({
    signUrl: SIGN_URL,
    connectUrl: CONNECT_URL,
    storageKey: opts.storageKey,
    windowRef,
  });

  return {
    client,
    storage,
    windowRef,
    emitMessage,
    get lastPopup(): FakePopup {
      return popups[popups.length - 1]!;
    },
    get lastOpenUrl() {
      return lastOpenUrl;
    },
  };
}

describe("FastWalletClient.getAddress / isConnected", () => {
  it("returns null / false when localStorage has no address", () => {
    const { client } = setup();
    expect(client.getAddress()).toBeNull();
    expect(client.isConnected()).toBe(false);
  });

  it("returns the cached address / true when localStorage has an address", () => {
    const { client } = setup({
      initialStorage: { [DEFAULT_STORAGE_KEY]: VALID_ADDRESS },
    });
    expect(client.getAddress()).toBe(VALID_ADDRESS);
    expect(client.isConnected()).toBe(true);
  });

  it("reads from a custom storageKey when provided", () => {
    const { client, storage } = setup({
      storageKey: "myapp:wallet",
      initialStorage: { "myapp:wallet": VALID_ADDRESS },
    });
    expect(client.getAddress()).toBe(VALID_ADDRESS);
    expect(storage!.getItem).toHaveBeenCalledWith("myapp:wallet");
  });

  it("returns null when localStorage is missing on windowRef", () => {
    const { client } = setup({ noStorage: true });
    expect(client.getAddress()).toBeNull();
    expect(client.isConnected()).toBe(false);
  });

  it("returns null when localStorage.getItem throws", () => {
    const { client } = setup({ throwOn: new Set(["getItem"]) });
    expect(client.getAddress()).toBeNull();
    expect(client.isConnected()).toBe(false);
  });
});

describe("FastWalletClient.disconnect", () => {
  it("clears the cached address from localStorage", () => {
    const { client, storage } = setup({
      initialStorage: { [DEFAULT_STORAGE_KEY]: VALID_ADDRESS },
    });
    expect(client.isConnected()).toBe(true);
    client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(storage!.removeItem).toHaveBeenCalledWith(DEFAULT_STORAGE_KEY);
  });

  it("is idempotent — disconnect twice with nothing cached does not throw", () => {
    const { client } = setup();
    expect(() => {
      client.disconnect();
      client.disconnect();
    }).not.toThrow();
  });

  it("uses the custom storageKey", () => {
    const { client, storage } = setup({
      storageKey: "myapp:wallet",
      initialStorage: { "myapp:wallet": VALID_ADDRESS },
    });
    client.disconnect();
    expect(storage!.removeItem).toHaveBeenCalledWith("myapp:wallet");
  });

  it("swallows errors when localStorage.removeItem throws", () => {
    const { client } = setup({ throwOn: new Set(["removeItem"]) });
    expect(() => client.disconnect()).not.toThrow();
  });

  it("is a no-op when localStorage is missing on windowRef", () => {
    const { client } = setup({ noStorage: true });
    expect(() => client.disconnect()).not.toThrow();
  });
});

describe("FastWalletClient.connect (cached branch)", () => {
  it("resolves immediately with the cached address, without opening a popup", async () => {
    const fake = setup({
      initialStorage: { [DEFAULT_STORAGE_KEY]: VALID_ADDRESS },
    });
    await expect(fake.client.connect({ metadata: TEST_METADATA })).resolves.toEqual({
      address: VALID_ADDRESS,
    });
    expect(fake.windowRef.open).not.toHaveBeenCalled();
  });

  it("resolves with the custom-storageKey address", async () => {
    const fake = setup({
      storageKey: "myapp:wallet",
      initialStorage: { "myapp:wallet": VALID_ADDRESS },
    });
    await expect(fake.client.connect({ metadata: TEST_METADATA })).resolves.toEqual({
      address: VALID_ADDRESS,
    });
    expect(fake.windowRef.open).not.toHaveBeenCalled();
  });
});

describe("FastWalletClient.connect (popup flow)", () => {
  it("opens connect popup with base64url ?request= envelope and resolves on success", async () => {
    const fake = setup();
    const promise = fake.client.connect({
      metadata: { name: "Demo", origin: DAPP_ORIGIN, icon: "/icon.svg" },
    });

    expect(fake.windowRef.open).toHaveBeenCalledTimes(1);
    expect(
      fake.lastOpenUrl?.startsWith(`${CONNECT_URL}?request=`),
    ).toBe(true);

    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });

    await expect(promise).resolves.toEqual({ address: VALID_ADDRESS });
    expect(fake.storage!.setItem).toHaveBeenCalledWith(
      DEFAULT_STORAGE_KEY,
      VALID_ADDRESS,
    );
  });

  it("persists the address under the custom storageKey", async () => {
    const fake = setup({ storageKey: "myapp:wallet" });
    const promise = fake.client.connect({ metadata: TEST_METADATA });
    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });
    await promise;
    expect(fake.storage!.setItem).toHaveBeenCalledWith(
      "myapp:wallet",
      VALID_ADDRESS,
    );
    expect(fake.client.getAddress()).toBe(VALID_ADDRESS);
  });

  it("rejects with popup_blocked when window.open returns null", async () => {
    const fake = setup({ openReturnsNull: true });
    await expect(fake.client.connect({ metadata: TEST_METADATA })).rejects.toMatchObject({
      name: "FastWalletError",
      code: "popup_blocked",
    });
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
  });

  it("rejects with the popup's error code on failure", async () => {
    const fake = setup();
    const promise = fake.client.connect({ metadata: TEST_METADATA });
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
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
  });

  it("opens a popup even when localStorage is unavailable (address not persisted)", async () => {
    const fake = setup({ noStorage: true });
    const promise = fake.client.connect({ metadata: TEST_METADATA });
    expect(fake.windowRef.open).toHaveBeenCalledTimes(1);
    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });
    await expect(promise).resolves.toEqual({ address: VALID_ADDRESS });
  });

  it("resolves with the address but skips persistence when setItem throws", async () => {
    const fake = setup({ throwOn: new Set(["setItem"]) });
    const promise = fake.client.connect({ metadata: TEST_METADATA });
    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });
    await expect(promise).resolves.toEqual({ address: VALID_ADDRESS });
  });

  it("ignores messages from the wrong origin", async () => {
    const fake = setup();
    const promise = fake.client.connect({ metadata: TEST_METADATA });
    fake.emitMessage({
      origin: "https://evil.com",
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });

    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);

    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });
    await expect(promise).resolves.toEqual({ address: VALID_ADDRESS });
  });

  it("ignores messages from a source other than the popup window", async () => {
    const fake = setup();
    const promise = fake.client.connect({ metadata: TEST_METADATA });
    fake.emitMessage({
      source: { not: "the popup" },
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });

    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);

    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });
    await expect(promise).resolves.toEqual({ address: VALID_ADDRESS });
  });
});

describe("FastWalletClient.connect (timer-driven popup paths)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with user_cancelled when the popup is closed", async () => {
    const fake = setup();
    const promise = fake.client.connect({ metadata: TEST_METADATA });
    const result = expect(promise).rejects.toMatchObject({
      name: "FastWalletError",
      code: "user_cancelled",
    });
    fake.lastPopup.closed = true;
    await vi.advanceTimersByTimeAsync(600);
    await result;
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
  });

  it("rejects with timeout after timeoutMs and closes the popup", async () => {
    const storage = makeFakeLocalStorage();
    const listeners: Array<(ev: unknown) => void> = [];
    const popups: FakePopup[] = [];
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
      localStorage: storage,
      open: vi.fn(() => makePopup()),
      addEventListener: vi.fn((_t: string, l: (ev: unknown) => void) => {
        listeners.push(l);
      }),
      removeEventListener: vi.fn(),
    };
    const client = new FastWalletClient({
      signUrl: SIGN_URL,
      connectUrl: CONNECT_URL,
      timeoutMs: 1000,
      windowRef,
    });

    const promise = client.connect({ metadata: TEST_METADATA });
    const result = expect(promise).rejects.toMatchObject({
      name: "FastWalletError",
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(1100);
    await result;
    expect(popups[0]?.close).toHaveBeenCalled();
  });
});

describe("FastWalletClient cross-method in-flight cancellation", () => {
  it("a new sign() cancels a pending connect()", async () => {
    const fake = setup();
    const connectPromise = fake.client.connect({ metadata: TEST_METADATA });

    fake.client.sign({ bytes: [1, 2, 3], metadata: TEST_METADATA });

    await expect(connectPromise).rejects.toMatchObject({
      name: "FastWalletError",
      code: "user_cancelled",
    });

    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { signature: "a".repeat(128) },
      },
    });
  });

  it("a new connect() cancels a pending sign()", async () => {
    const fake = setup();
    const signPromise = fake.client.sign({ bytes: [1, 2, 3], metadata: TEST_METADATA });

    fake.client.connect({ metadata: TEST_METADATA });

    await expect(signPromise).rejects.toMatchObject({
      name: "FastWalletError",
      code: "user_cancelled",
    });

    fake.emitMessage({
      data: {
        t: "fast-popup-result",
        ok: true,
        result: { address: VALID_ADDRESS },
      },
    });
  });
});
