import { InsufficientFundingError } from "../error/fastset";
import { RestError } from "../error/network";
import {
  DatabaseError,
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

const parseBalance = (value: unknown): bigint | undefined => {
  // Balance is signed; classification must not impose fee-accounting rules.
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : undefined;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
};

/** Parse a REST error envelope into a typed error. */
export const parseRestError = (
  status: number,
  err: { readonly code: string; readonly message: string; readonly details?: unknown },
) => {
  const { code, message, details } = err;
  const d = details as Record<string, unknown> | undefined;

  switch (code) {
    case "VALIDATOR_REJECTED": {
      const funding = d?.InsufficientFundingForFee;
      if (
        typeof funding === "object" &&
        funding !== null &&
        !Array.isArray(funding)
      ) {
        const f = funding as Record<string, unknown>;
        const currentBalance = parseBalance(f.current_balance);
        const needed = parseBalance(f.needed);
        const tokenId = f.token_id;
        if (
          currentBalance !== undefined &&
          needed !== undefined &&
          (tokenId === null ||
            (Array.isArray(tokenId) &&
              tokenId.length === 32 &&
              Array.from(tokenId).every(
                (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
              )))
        ) {
          return new InsufficientFundingError({
            message,
            currentBalance,
            needed,
            tokenId: tokenId === null ? null : new Uint8Array(tokenId),
          });
        }
      }
      return new RestError({ status, code, message, details });
    }
    case "INVALID_REQUEST":
      return new InvalidRequestError({ message });
    case "NOT_FOUND":
      return new NotFoundError({ message });
    case "TOO_MANY_CERTIFICATES_REQUESTED":
      return new TooManyCertificatesRequestedError({ message });
    case "UNEXPECTED_NONCE":
      return new ProxyUnexpectedNonceError({
        message,
        txNonce: BigInt((d?.tx_nonce as string | number) ?? 0),
        expectedNonce: BigInt((d?.expected_nonce as string | number) ?? 0),
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
    case "DATABASE_ERROR":
      return new DatabaseError({ message });
    default:
      return new RestError({ status, code, message, details });
  }
};
