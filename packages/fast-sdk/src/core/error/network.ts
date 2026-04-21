import { Data } from "effect";

/** @deprecated Use `RestTimeoutError` instead. */
export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  readonly method: string;
  readonly timeoutMs: number;
}> {}

/** REST call exceeded the timeout. */
export class RestTimeoutError extends Data.TaggedError("RestTimeoutError")<{
  readonly path: string;
  readonly timeoutMs: number;
}> {}

/** Fallback for unknown or unparseable REST errors. */
export class RestError extends Data.TaggedError("RestError")<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}> {}
