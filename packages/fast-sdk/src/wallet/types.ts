/** Dapp self-reported identity for popup UI display. Optional. */
export interface DappMetadata {
  /** Dapp name shown in UI — untrusted. */
  name: string;
  /** Must equal SignRequestEnvelope.dappOrigin. */
  origin: string;
  /** Dapp icon URL or data: URI. */
  icon?: string;
}

/**
 * SDK → popup request envelope.
 * Encoded as base64url(JSON.stringify(...)) and placed in the URL query string `?p=`.
 */
export interface SignRequestEnvelope {
  /** Filled automatically by the SDK from window.location.origin; dapp code cannot forge it. */
  dappOrigin: string;
  /** Final to-be-signed bytes prepared by the dapp using fast-sdk; each element 0-255. */
  bytes: number[];
  /** Optional; when omitted the popup UI shows only dappOrigin. */
  metadata?: DappMetadata;
}

/** Return value of a successful popup sign. */
export interface SignResult {
  /** Ed25519 signature in hex (no 0x prefix), 128 hex chars. */
  signature: string;
}

/** Reason code for sign() failures. */
export type ErrorCode =
  | "user_rejected"
  | "user_cancelled"
  | "timeout"
  | "origin_mismatch"
  | "signing_failed"
  | "popup_blocked"
  | "invalid_payload"
  | "url_too_large";

/** popup → SDK message posted via window.opener.postMessage. */
export type ResultMsg =
  | { t: "fast-popup-result"; ok: true; result: SignResult }
  | {
      t: "fast-popup-result";
      ok: false;
      error: { code: ErrorCode; message: string };
    };
