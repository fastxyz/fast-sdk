/** Dapp self-reported identity for popup UI display. Optional. */
export interface DappMetadata {
  /** Dapp name shown in UI — untrusted. */
  name: string;
  /** Must equal the request envelope's dappOrigin. */
  origin: string;
  /** Dapp icon URL or data: URI. */
  icon?: string;
}

/**
 * SDK → popup sign request envelope.
 * Encoded as base64url(JSON.stringify(...)) and placed in the URL query `?tx=`.
 */
export interface SignRequestEnvelope {
  /** Filled by the SDK from window.location.origin; dapp code cannot forge it. */
  dappOrigin: string;
  /** Final to-be-signed bytes prepared by the dapp using fast-sdk; each element 0-255. */
  bytes: number[];
  metadata?: DappMetadata;
}

/**
 * SDK → popup connect request envelope.
 * Encoded as base64url(JSON.stringify(...)) and placed in the URL query `?request=`.
 */
export interface ConnectRequestEnvelope {
  /** Filled by the SDK from window.location.origin; dapp code cannot forge it. */
  dappOrigin: string;
  metadata?: DappMetadata;
}

/** Return value of a successful popup sign. */
export interface SignResult {
  /** Ed25519 signature in hex (no 0x prefix), 128 hex chars. */
  signature: string;
}

/** Return value of a successful popup connect. */
export interface ConnectResult {
  /** FAST account bech32 address starting with `fast1`. */
  address: string;
}

/** Reason code for sign() / connect() failures. */
export type ErrorCode =
  | "user_rejected"
  | "user_cancelled"
  | "timeout"
  | "origin_mismatch"
  | "signing_failed"
  | "sender_not_owned"
  | "popup_blocked"
  | "invalid_payload"
  | "url_too_large";

/** popup → SDK message posted via window.opener.postMessage. */
export type ResultMsg =
  | {
      t: "fast-popup-result";
      ok: true;
      result: ConnectResult | SignResult;
    }
  | {
      t: "fast-popup-result";
      ok: false;
      error: { code: ErrorCode; message: string };
    };
