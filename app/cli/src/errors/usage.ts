import { Data } from "effect";

export class InvalidUsageError extends Data.TaggedError("InvalidUsageError")<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INVALID_USAGE" as const;
}

export class NotImplementedError extends Data.TaggedError(
  "NotImplementedError",
)<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "NOT_IMPLEMENTED" as const;
}

export class UserCancelledError extends Data.TaggedError("UserCancelledError") {
  readonly exitCode = 2 as const;
  readonly errorCode = "USER_CANCELLED" as const;
  get message() {
    return "Operation cancelled by user";
  }
}
