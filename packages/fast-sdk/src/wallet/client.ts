import { Encoding } from "effect";
import { FastWalletError } from "./errors";
import {
  parseConnectRequestEnvelope,
  parseResultMsg,
  parseSignRequestEnvelope,
} from "./schema";
import type {
  ConnectResult,
  DappMetadata,
  ResultMsg,
  SignResult,
} from "./types";

/** Minimal subset of a popup window used by the client. */
export interface PopupWindowLike {
  closed: boolean;
  close(): void;
}

/** Minimal subset of window injected for testability. */
export interface WindowLike {
  location: { origin: string };
  /**
   * Optional — when absent, connect-state methods (getAddress / isConnected /
   * connect / disconnect) gracefully degrade as if no address is cached.
   */
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  open(
    url: string,
    target: string,
    features: string,
  ): PopupWindowLike | null;
  addEventListener(
    type: "message",
    listener: (ev: MessageEventLike) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (ev: MessageEventLike) => void,
  ): void;
}

/** Fields of a postMessage event used by the client. */
export interface MessageEventLike {
  source: unknown;
  origin: string;
  data: unknown;
}

export interface FastWalletClientOptions {
  /**
   * Full URL of the popup signing route; defaults to
   * "https://app.fast.xyz/sign". The query `?tx=` is appended by the client.
   */
  signUrl?: string;
  /**
   * Full URL of the popup connect route; defaults to
   * "https://app.fast.xyz/connect". The query `?request=` is appended by the
   * client.
   */
  connectUrl?: string;
  /** Global timeout for sign/connect popup flows; defaults to 5 minutes. */
  timeoutMs?: number;
  /**
   * localStorage key under which the connected address is persisted.
   * Defaults to "fastxyz:wallet:address".
   */
  storageKey?: string;
  /** Injected window reference; defaults to globalThis.window. */
  windowRef?: WindowLike;
}

export interface SignArgs {
  /** Final to-be-signed bytes prepared by the dapp using fast-sdk. */
  bytes: number[];
  /** Optional dapp self-reported identity. */
  metadata?: DappMetadata;
}

export interface ConnectArgs {
  /** Optional dapp self-reported identity. */
  metadata?: DappMetadata;
}

const DEFAULT_SIGN_URL = "https://app.fast.xyz/sign";
const DEFAULT_CONNECT_URL = "https://app.fast.xyz/connect";
const DEFAULT_STORAGE_KEY = "fastxyz:wallet:address";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POPUP_FEATURES = "popup=yes,width=430,height=720";
const CLOSED_POLL_MS = 500;
const MAX_URL_LENGTH = 16384;

/** Cancellable handle for a single in-flight popup call (sign or connect). */
interface InFlight {
  reject(err: FastWalletError): void;
  cleanup(): void;
  popup: PopupWindowLike;
}

/**
 * Dapp-side client that delegates wallet operations to a popup window hosted by
 * the fast app. Does not depend on a browser extension. Only one in-flight
 * popup call (sign or connect) is supported at a time — starting a new one
 * cancels the previous.
 */
export class FastWalletClient {
  private readonly signUrl: string;
  /** Origin of signUrl — used to validate the sign postMessage. */
  private readonly signOrigin: string;
  private readonly connectUrl: string;
  /** Origin of connectUrl — used to validate the connect postMessage. */
  private readonly connectOrigin: string;
  private readonly storageKey: string;
  private readonly timeoutMs: number;
  private readonly windowRef: WindowLike;
  private inFlight: InFlight | null = null;

  constructor(options: FastWalletClientOptions = {}) {
    this.signUrl = options.signUrl ?? DEFAULT_SIGN_URL;
    this.signOrigin = new URL(this.signUrl).origin;
    this.connectUrl = options.connectUrl ?? DEFAULT_CONNECT_URL;
    this.connectOrigin = new URL(this.connectUrl).origin;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const win = options.windowRef ?? (globalThis as { window?: WindowLike }).window;
    if (!win) {
      throw new FastWalletError(
        "popup_blocked",
        "FastWalletClient requires a browser window (or an injected windowRef)",
      );
    }
    this.windowRef = win;
  }

  /** Returns the cached connected address, or null if none / storage unavailable. */
  getAddress(): string | null {
    try {
      return this.windowRef.localStorage?.getItem(this.storageKey) ?? null;
    } catch {
      return null;
    }
  }

  isConnected(): boolean {
    return this.getAddress() !== null;
  }

  /** Clears the cached connected address. Idempotent. Swallows storage errors. */
  disconnect(): void {
    try {
      this.windowRef.localStorage?.removeItem(this.storageKey);
    } catch {}
  }

  /**
   * Resolves with the connected address. If an address is already cached in
   * localStorage, resolves immediately without opening a popup; otherwise
   * opens the connect popup, awaits user selection, and persists the result.
   */
  connect(args: ConnectArgs = {}): Promise<ConnectResult> {
    const cached = this.getAddress();
    if (cached !== null) {
      return Promise.resolve({ address: cached });
    }

    const envelope = {
      dappOrigin: this.windowRef.location.origin,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    };

    try {
      parseConnectRequestEnvelope(envelope);
    } catch (cause) {
      return Promise.reject(
        new FastWalletError(
          "invalid_payload",
          `connect request failed schema validation: ${String(cause)}`,
        ),
      );
    }

    const json = JSON.stringify(envelope);
    const request = Encoding.encodeBase64Url(new TextEncoder().encode(json));
    const url = `${this.connectUrl}?request=${request}`;

    return this.openPopupAndAwait(url, this.connectOrigin).then((msg) => {
      if (!msg.ok) {
        throw new FastWalletError(msg.error.code, msg.error.message);
      }
      if (!("address" in msg.result)) {
        throw new FastWalletError(
          "invalid_payload",
          "popup returned unexpected result shape for connect",
        );
      }
      const address = msg.result.address;
      try {
        this.windowRef.localStorage?.setItem(this.storageKey, address);
      } catch {}
      return { address };
    });
  }

  /**
   * Opens a popup to let the user authorize and sign `args.bytes`.
   *
   * Must be called synchronously inside a user-gesture handler (window.open is
   * called in the first turn), otherwise the browser popup blocker may suppress it.
   */
  sign(args: SignArgs): Promise<SignResult> {
    const envelope = {
      dappOrigin: this.windowRef.location.origin,
      bytes: args.bytes,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    };

    try {
      parseSignRequestEnvelope(envelope);
    } catch (cause) {
      return Promise.reject(
        new FastWalletError(
          "invalid_payload",
          `sign request failed schema validation: ${String(cause)}`,
        ),
      );
    }

    const json = JSON.stringify(envelope);
    const tx = Encoding.encodeBase64Url(new TextEncoder().encode(json));
    const url = `${this.signUrl}?tx=${tx}`;

    return this.openPopupAndAwait(url, this.signOrigin).then((msg) => {
      if (!msg.ok) {
        throw new FastWalletError(msg.error.code, msg.error.message);
      }
      if (!("signature" in msg.result)) {
        throw new FastWalletError(
          "invalid_payload",
          "popup returned unexpected result shape for sign",
        );
      }
      return { signature: msg.result.signature };
    });
  }

  /**
   * Opens `url` in a popup, awaits a single `fast-popup-result` postMessage
   * from `expectedOrigin`, and returns the validated message. A new call
   * cancels the previous in-flight popup (single in-flight slot shared by
   * sign + connect, so the dapp can't accidentally orphan two popups).
   *
   * The body up to and including window.open runs synchronously so the caller
   * preserves user-gesture context for the popup blocker.
   */
  private openPopupAndAwait(
    url: string,
    expectedOrigin: string,
  ): Promise<ResultMsg> {
    if (this.inFlight) {
      const prev = this.inFlight;
      this.inFlight = null;
      // cleanup() must run before popup.close() — otherwise the closed-poll
      // interval could observe closed===true and attempt to settle before the
      // interval is cleared.
      prev.cleanup();
      prev.popup.close();
      prev.reject(
        new FastWalletError(
          "user_cancelled",
          "superseded by a new popup call",
        ),
      );
    }

    if (url.length > MAX_URL_LENGTH) {
      return Promise.reject(
        new FastWalletError(
          "url_too_large",
          `encoded request URL is ${url.length} chars, exceeds ${MAX_URL_LENGTH}`,
        ),
      );
    }

    const popup = this.windowRef.open(url, "fast-wallet", POPUP_FEATURES);
    if (!popup) {
      return Promise.reject(
        new FastWalletError(
          "popup_blocked",
          "window.open returned null; popup was blocked",
        ),
      );
    }

    return new Promise<ResultMsg>((resolve, reject) => {
      let settled = false;
      const listener = (ev: MessageEventLike) => {
        if (
          ev.source !== popup ||
          ev.origin !== expectedOrigin ||
          (ev.data as { t?: unknown })?.t !== "fast-popup-result"
        ) {
          return;
        }
        let msg: ResultMsg;
        try {
          msg = parseResultMsg(ev.data);
        } catch {
          return; // Malformed shape — treat as noise and ignore.
        }
        finish(() => resolve(msg));
      };

      const closedPoll = setInterval(() => {
        if (popup.closed) {
          finish(() =>
            reject(
              new FastWalletError(
                "user_cancelled",
                "popup was closed before completing",
              ),
            ),
          );
        }
      }, CLOSED_POLL_MS);

      const timeout = setTimeout(() => {
        popup.close();
        finish(() =>
          reject(
            new FastWalletError(
              "timeout",
              `no result within ${this.timeoutMs}ms`,
            ),
          ),
        );
      }, this.timeoutMs);

      const cleanup = () => {
        this.windowRef.removeEventListener("message", listener);
        clearInterval(closedPoll);
        clearTimeout(timeout);
      };

      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.inFlight?.popup === popup) this.inFlight = null;
        settle();
      };

      // inFlight must be set before addEventListener so any message arriving
      // immediately after registration sees a consistent inFlight state.
      this.inFlight = {
        popup,
        cleanup,
        reject: (err) => {
          finish(() => reject(err));
        },
      };
      this.windowRef.addEventListener("message", listener);
    });
  }
}
