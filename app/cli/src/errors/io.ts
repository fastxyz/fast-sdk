import { Data } from "effect";

/** File I/O, lock, or persistence failure. */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Unexpected internal error (defect/bug caught at the boundary). */
export class InternalError extends Data.TaggedError("InternalError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
