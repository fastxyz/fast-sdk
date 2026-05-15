import type { ErrorCode } from "./types";

/**
 * Error thrown by FastWalletClient.sign() / connect() on failure.
 * Distinguish the cause with `err instanceof FastWalletError` + `err.code`.
 */
export class FastWalletError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "FastWalletError";
    this.code = code;
  }
}
