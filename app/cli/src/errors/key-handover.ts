import type { KeyHandoverErrorCode } from "@fastxyz/sdk/wallet";
import { Data } from "effect";

export class PendingAlreadyExistsError extends Data.TaggedError(
  "PendingAlreadyExistsError",
)<{ fingerprint: string; expiresAt: string }> {
  readonly exitCode = 1 as const;
  readonly errorCode = "PENDING_ALREADY_EXISTS" as const;
  get message() {
    return `Already have a pending authorization request (fingerprint ${this.fingerprint}, expires ${this.expiresAt}). Run 'fast authorize complete' to finish it, or wait until it expires.`;
  }
}

export class NoPendingRequestError extends Data.TaggedError(
  "NoPendingRequestError",
) {
  readonly exitCode = 1 as const;
  readonly errorCode = "NO_PENDING_REQUEST" as const;
  readonly message =
    "No pending authorization request. Run 'fast authorize request' first.";
}

export class CorruptPendingStateError extends Data.TaggedError(
  "CorruptPendingStateError",
)<{ reason: string }> {
  readonly exitCode = 1 as const;
  readonly errorCode = "CORRUPT_PENDING_STATE" as const;
  get message() {
    return `Corrupt pending state file (${this.reason}). Delete ~/.fast/handover-pending.json and run 'request' again.`;
  }
}

export class MissingHandoverMessageError extends Data.TaggedError(
  "MissingHandoverMessageError",
) {
  readonly exitCode = 2 as const;
  readonly errorCode = "MISSING_HANDOVER_MESSAGE" as const;
  readonly message =
    "Missing handover code. Provide --message <code> or --stdin, or run without --non-interactive.";
}

export class KeyHandoverProtocolError extends Data.TaggedError(
  "KeyHandoverProtocolError",
)<{ sdkCode: KeyHandoverErrorCode; message: string }> {
  readonly exitCode = 1 as const;
  readonly errorCode = "KEY_HANDOVER_PROTOCOL_ERROR" as const;
}
