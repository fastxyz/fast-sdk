import { RestError } from "../error/network";
import {
  GeneralError,
  InvalidRequestError,
  IpRateLimitedError,
  NotFoundError,
  ProxyUnexpectedNonceError,
  ServiceUnavailableError,
  TooManyCertificatesRequestedError,
  UpstreamError,
  VerifierSigsInvalidError,
} from "../error/proxy";

/** Parse a REST error envelope into a typed error. */
export const parseRestError = (
  status: number,
  err: { readonly code: string; readonly message: string; readonly details?: unknown },
) => {
  const { code, message, details } = err;
  const d = details as Record<string, unknown> | undefined;

  switch (code) {
    case "INVALID_REQUEST":
      return new InvalidRequestError({ message });
    case "NOT_FOUND":
      return new NotFoundError({ message });
    case "TOO_MANY_CERTIFICATES_REQUESTED":
      return new TooManyCertificatesRequestedError({ message });
    case "UNEXPECTED_NONCE":
      return new ProxyUnexpectedNonceError({
        message,
        txNonce: BigInt((d?.tx_nonce as number) ?? 0),
        expectedNonce: BigInt((d?.expected_nonce as number) ?? 0),
      });
    case "VERIFIER_SIGNATURES_INVALID":
      return new VerifierSigsInvalidError({ message });
    case "INTERNAL_ERROR":
      return new GeneralError({ message });
    case "UPSTREAM_ERROR":
      return new UpstreamError({ message });
    case "IP_RATE_LIMITED":
      return new IpRateLimitedError({
        message,
        retryAfterSecs: (d?.retry_after_secs as number) ?? 0,
      });
    case "SERVICE_UNAVAILABLE":
      return new ServiceUnavailableError({ message });
    default:
      return new RestError({ status, code, message, details });
  }
};
