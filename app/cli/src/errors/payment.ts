import { Data } from "effect";

export class PaymentRejectedError extends Data.TaggedError(
  "PaymentRejectedError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 6 as const;
  readonly errorCode = "PAYMENT_REJECTED" as const;
}

export class PaymentFailedError extends Data.TaggedError(
  "PaymentFailedError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "PAYMENT_FAILED" as const;
}

export class InvalidPaymentLinkError extends Data.TaggedError(
  "InvalidPaymentLinkError",
)<{
  readonly message: string;
}> {
  readonly exitCode = 2 as const;
  readonly errorCode = "INVALID_PAYMENT_LINK" as const;
}

export class InsufficientPaymentBalanceError extends Data.TaggedError(
  "InsufficientPaymentBalanceError",
)<{
  readonly message: string;
}> {
  readonly exitCode = 4 as const;
  readonly errorCode = "INSUFFICIENT_PAYMENT_BALANCE" as const;
}
