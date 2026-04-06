import { Data } from "effect";

/** BCS serialization failed. */
export class BcsEncodeError extends Data.TaggedError("BcsEncodeError")<{
  readonly cause: unknown;
}> {}

/** Ed25519 signing failed. */
export class SigningError extends Data.TaggedError("SigningError")<{
  readonly cause: unknown;
}> {}

/** Ed25519 public key derivation failed. */
export class PublicKeyError extends Data.TaggedError("PublicKeyError")<{
  readonly cause: unknown;
}> {}

/** Ed25519 signature verification failed unexpectedly. */
export class VerifyError extends Data.TaggedError("VerifyError")<{
  readonly cause: unknown;
}> {}
