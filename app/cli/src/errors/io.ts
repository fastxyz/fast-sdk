import { Data } from "effect";

/** File I/O, lock, or persistence failure. */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "STORAGE_ERROR" as const;
}

/** Unexpected internal error (defect/bug caught at the boundary). */
export class InternalError extends Data.TaggedError("InternalError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "INTERNAL_ERROR" as const;
}
