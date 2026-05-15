import { Encoding } from "effect";
import { FastWalletError } from "./errors";
import { parseResultMsg, parseSignRequestEnvelope } from "./schema";
import type { DappMetadata, SignResult } from "./types";

/** Minimal subset of a popup window used by the client. */
export interface PopupWindowLike {
  closed: boolean;
  close(): void;
}

/** Minimal subset of window injected for testability. */
export interface WindowLike {
  location: { origin: string };
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
   * Full URL of the popup signing route (without query string); defaults to
   * "https://app.fast.xyz/wallet/sign". The query `?tx=` is appended by the
   * client. Both origin and path are configurable.
   */
  popupUrl?: string;
  /** Global timeout; defaults to 5 minutes. */
  timeoutMs?: number;
  /** Injected window reference; defaults to globalThis.window. */
  windowRef?: WindowLike;
}

export interface SignArgs {
  /** Final to-be-signed bytes prepared by the dapp using fast-sdk. */
  bytes: number[];
  /** Optional dapp self-reported identity. */
  metadata?: DappMetadata;
}

const DEFAULT_POPUP_URL = "https://app.fast.xyz/wallet/sign";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POPUP_FEATURES = "popup=yes,width=400,height=600";
const CLOSED_POLL_MS = 500;
const MAX_URL_LENGTH = 16384;

/** Cancellable handle for a single in-flight sign() call. */
interface InFlight {
  reject(err: FastWalletError): void;
  cleanup(): void;
  popup: PopupWindowLike;
}

/**
 * Dapp-side client that delegates signing to a popup window hosted by the fast app.
 * Does not depend on a browser extension. Only one in-flight sign() is supported at a time.
 */
export class FastWalletClient {
  private readonly popupUrl: string;
  /** Origin of popupUrl — used to validate the postMessage result event. */
  private readonly popupOrigin: string;
  private readonly timeoutMs: number;
  private readonly windowRef: WindowLike;
  private inFlight: InFlight | null = null;

  constructor(options: FastWalletClientOptions = {}) {
    this.popupUrl = options.popupUrl ?? DEFAULT_POPUP_URL;
    this.popupOrigin = new URL(this.popupUrl).origin;
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

  /**
   * Opens a popup to let the user authorize and sign `args.bytes`.
   *
   * Must be called synchronously inside a user-gesture handler (window.open is
   * called in the first turn), otherwise the browser popup blocker may suppress it.
   */
  sign(args: SignArgs): Promise<SignResult> {
    // Single in-flight: cancel the previous one.
    if (this.inFlight) {
      const prev = this.inFlight;
      this.inFlight = null;
      // cleanup() must run before popup.close() — otherwise the closed-poll interval
      // could observe closed===true and attempt to settle before the interval is cleared.
      prev.cleanup();
      prev.popup.close();
      prev.reject(
        new FastWalletError(
          "user_cancelled",
          "superseded by a new sign() call",
        ),
      );
    }

    const envelope = {
      dappOrigin: this.windowRef.location.origin,
      bytes: args.bytes,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    };

    // Schema validation: throw synchronously on failure, before opening any popup.
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
    const url = `${this.popupUrl}?tx=${tx}`;
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

    return new Promise<SignResult>((resolve, reject) => {
      let settled = false;
      const listener = (ev: MessageEventLike) => {
        if (
          ev.source !== popup ||
          ev.origin !== this.popupOrigin ||
          (ev.data as { t?: unknown })?.t !== "fast-popup-result"
        ) {
          return;
        }
        let msg: ReturnType<typeof parseResultMsg>;
        try {
          msg = parseResultMsg(ev.data);
        } catch {
          return; // Malformed shape — treat as noise and ignore.
        }
        if (msg.ok) {
          finish(() => resolve(msg.result));
        } else {
          finish(() =>
            reject(new FastWalletError(msg.error.code, msg.error.message)),
          );
        }
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

      // inFlight must be set before addEventListener so that any message arriving
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
