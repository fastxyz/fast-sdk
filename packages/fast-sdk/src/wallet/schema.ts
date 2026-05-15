import { Schema } from "effect";
import type {
  ConnectRequestEnvelope,
  ResultMsg,
  SignRequestEnvelope,
} from "./types";

/** Integer in 0-255 (one byte). */
const ByteSchema = Schema.Int.pipe(Schema.between(0, 255));

/** Valid http(s) origin string. */
const OriginSchema = Schema.String.pipe(
  Schema.filter(
    (s) => {
      try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: () => "must be a valid http(s) origin" },
  ),
);

const DappMetadataSchema = Schema.Struct({
  name: Schema.String,
  origin: OriginSchema,
  icon: Schema.optional(Schema.String),
});

const SignRequestEnvelopeSchema = Schema.Struct({
  dappOrigin: OriginSchema,
  bytes: Schema.mutable(Schema.Array(ByteSchema).pipe(Schema.maxItems(8192))),
  metadata: Schema.optional(DappMetadataSchema),
}).pipe(
  Schema.filter(
    (env) =>
      env.metadata === undefined || env.metadata.origin === env.dappOrigin,
    { message: () => "metadata.origin must equal dappOrigin" },
  ),
);

const ConnectRequestEnvelopeSchema = Schema.Struct({
  dappOrigin: OriginSchema,
  metadata: Schema.optional(DappMetadataSchema),
}).pipe(
  Schema.filter(
    (env) =>
      env.metadata === undefined || env.metadata.origin === env.dappOrigin,
    { message: () => "metadata.origin must equal dappOrigin" },
  ),
);

const SignatureSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-fA-F]{128}$/),
);

const AddressSchema = Schema.String.pipe(
  Schema.pattern(/^fast1[a-z0-9]{20,80}$/),
);

const ErrorCodeSchema = Schema.Literal(
  "user_rejected",
  "user_cancelled",
  "timeout",
  "origin_mismatch",
  "signing_failed",
  "sender_not_owned",
  "popup_blocked",
  "invalid_payload",
  "url_too_large",
  "not_implemented",
);

const ResultMsgSchema = Schema.Union(
  Schema.Struct({
    t: Schema.Literal("fast-popup-result"),
    ok: Schema.Literal(true),
    result: Schema.Union(
      Schema.Struct({ signature: SignatureSchema }),
      Schema.Struct({ address: AddressSchema }),
    ),
  }),
  Schema.Struct({
    t: Schema.Literal("fast-popup-result"),
    ok: Schema.Literal(false),
    error: Schema.Struct({
      code: ErrorCodeSchema,
      message: Schema.String,
    }),
  }),
);

/**
 * Strictly validates a SignRequestEnvelope — rejecting undeclared fields.
 * Called once on the SDK side before sending, and once on the popup side after receiving.
 */
export function parseSignRequestEnvelope(
  input: unknown,
): SignRequestEnvelope {
  return Schema.decodeUnknownSync(SignRequestEnvelopeSchema, {
    onExcessProperty: "error",
  })(input);
}

/**
 * Strictly validates a ConnectRequestEnvelope — rejecting undeclared fields.
 * Called once on the SDK side before sending, and once on the popup side after receiving.
 */
export function parseConnectRequestEnvelope(
  input: unknown,
): ConnectRequestEnvelope {
  return Schema.decodeUnknownSync(ConnectRequestEnvelopeSchema, {
    onExcessProperty: "error",
  })(input);
}

/**
 * Strictly validates a ResultMsg posted back from the popup — throws on failure.
 * The success-branch `result` is a union of ConnectResult and SignResult;
 * callers narrow by checking which property is present.
 */
export function parseResultMsg(input: unknown): ResultMsg {
  return Schema.decodeUnknownSync(ResultMsgSchema, {
    onExcessProperty: "error",
  })(input);
}
