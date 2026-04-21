import { Effect, Schema } from "effect";
import { JSONParse, JSONStringify } from "json-with-bigint";
import { RestTimeoutError } from "../error/network";
import { parseRestError } from "./error";

/**
 * REST success envelope: `{ data: T, meta: { timestamp } }`.
 */
const RestSuccessEnvelope = Schema.Struct({
  data: Schema.Unknown,
  meta: Schema.Struct({ timestamp: Schema.String }),
});

/**
 * REST error envelope: `{ error: { code, details, message }, meta: { timestamp } }`.
 */
const RestErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    details: Schema.optional(Schema.Unknown),
  }),
  meta: Schema.Struct({ timestamp: Schema.String }),
});

export interface RestRequestOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/** Perform a REST API call, unwrap the success/error envelope. */
export const restCallEffect = (
  baseUrl: string,
  opts: RestRequestOptions,
) => {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return Effect.gen(function* () {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}${opts.path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    const fetchOpts: RequestInit = { method: opts.method };
    if (opts.body !== undefined) {
      fetchOpts.headers = { "Content-Type": "application/json" };
      fetchOpts.body = JSONStringify(opts.body);
    }

    const res = yield* Effect.tryPromise(() => fetch(url.toString(), fetchOpts));
    const text = yield* Effect.tryPromise(() => res.text());

    let json: unknown;
    try {
      json = JSONParse(text);
    } catch {
      // Non-JSON response (e.g. plain-text proxy errors)
      return yield* parseRestError(res.status, {
        code: `HTTP_${res.status}`,
        message: text.slice(0, 200),
      });
    }

    if (!res.ok) {
      const errEnv = yield* Schema.decodeUnknown(RestErrorEnvelope)(json);
      return yield* parseRestError(res.status, errEnv.error);
    }

    const okEnv = yield* Schema.decodeUnknown(RestSuccessEnvelope)(json);
    return okEnv.data;
  }).pipe(
    Effect.timeout(`${timeoutMs} millis`),
    Effect.catchTag(
      "TimeoutException",
      () => new RestTimeoutError({ path: opts.path, timeoutMs }),
    ),
  );
};
