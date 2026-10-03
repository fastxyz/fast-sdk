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

export class PaymentTimeoutError extends Data.TaggedError(
  "PaymentTimeoutError",
)<{
  /** Human description of the payment that was expected. */
  readonly expected: string;
  readonly timeoutSeconds: number;
  /** Why the final explorer poll did not complete (an error, or still in flight at the deadline). */
  readonly lastError?: string;
}> {
  readonly exitCode = 1 as const;
  readonly errorCode = "PAYMENT_TIMEOUT" as const;
  get message() {
    const base = `No matching payment arrived within ${this.timeoutSeconds}s (expected ${this.expected}).`;
    return this.lastError
      ? `${base} The last explorer poll did not complete, so a payment may have arrived unseen: ${this.lastError}`
      : base;
  }
}
