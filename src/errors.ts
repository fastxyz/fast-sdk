/**
 * errors.ts — Structured error codes for Fast SDK.
 *
 * Every throwable error from the SDK is a FastError with a machine-readable
 * `code`. Agents can switch on `code` instead of parsing message strings.
 */

export type FastErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'CHAIN_NOT_CONFIGURED'
  | 'TX_FAILED'
  | 'INVALID_ADDRESS'
  | 'TOKEN_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'UNSUPPORTED_OPERATION';

export class FastError extends Error {
  readonly code: FastErrorCode;
  readonly note: string;

  constructor(
    code: FastErrorCode,
    message: string,
    opts?: { note?: string }
  ) {
    super(message);
    this.name = 'FastError';
    this.code = code;
    this.note = opts?.note ?? '';
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      note: this.note,
    };
  }
}
