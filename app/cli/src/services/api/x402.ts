import {
  x402Pay,
  parse402Response,
  type X402PayParams,
} from "@fastxyz/x402-client";
import { Effect } from "effect";
import {
  InvalidPaymentLinkError,
  PaymentFailedError,
  PaymentRejectedError,
} from "../../errors/index.js";

const mapX402Error = (cause: unknown) => {
  const msg =
    cause instanceof Error ? cause.message : String(cause);
  if (msg.includes("rejected") || msg.includes("denied")) {
    return new PaymentRejectedError({ message: msg, cause });
  }
  return new PaymentFailedError({ message: msg, cause });
};

const pay = (params: X402PayParams) =>
  Effect.tryPromise({
    try: () => x402Pay(params),
    catch: mapX402Error,
  });

const dryRun = (url: string, method: string, headers?: Record<string, string>) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, { method, headers });
      if (res.status !== 402) {
        return { status: res.status, paymentRequired: null };
      }
      const parsed = await parse402Response(res);
      return {
        status: 402,
        paymentRequired: parsed,
      };
    },
    catch: (cause) =>
      new InvalidPaymentLinkError({
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to reach ${url}`,
      }),
  });

const ServiceEffect = Effect.succeed({ pay, dryRun });

export class X402Service extends Effect.Service<X402Service>()(
  "X402Service",
  { effect: ServiceEffect },
) {}
