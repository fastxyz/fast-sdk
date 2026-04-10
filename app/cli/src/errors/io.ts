import { Data } from "effect";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "DATABASE_ERROR" as const;
}

export class FileIOError extends Data.TaggedError("FileIOError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "FILE_IO_ERROR" as const;
}

/** Unexpected internal error (defect/bug caught at the boundary). */
export class InternalError extends Data.TaggedError("InternalError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "INTERNAL_ERROR" as const;
}

/** Fast SDK RPC or operation failure (wraps all SDK error types into one). */
export class FastSdkError extends Data.TaggedError("FastSdkError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "FAST_SDK_ERROR" as const;
}
