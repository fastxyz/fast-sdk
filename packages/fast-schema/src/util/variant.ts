import { Either, ParseResult, Schema } from 'effect';
import type { Transformation } from 'effect/SchemaAST';

const KeyedVariantSchema = Schema.Union(Schema.Record({ key: Schema.String, value: Schema.Unknown }), Schema.String);

const TypedVariantSchema = Schema.Struct({
  type: Schema.String,
  value: Schema.optional(Schema.Unknown),
});

/**
 * Encoded type for a variant record.
 *
 * - `"serde"` (default): unit variants encode as bare strings (`"LeaveCommittee"`)
 * - `"bcs"`: unit variants encode as `{ "LeaveCommittee": readonly [] }`
 */
type VariantEncoded<V extends Record<string, Schema.Schema.All | null>, Mode extends 'serde' | 'bcs' = 'serde'> = {
  [K in keyof V & string]: V[K] extends Schema.Schema.All
    ? { readonly [P in K]: Schema.Schema.Encoded<V[K]> }
    : Mode extends 'bcs'
      ? { readonly [P in K]: readonly [] }
      : K;
}[keyof V & string];

/**
 * Builds a typed, bidirectional schema for Rust externally-tagged enums.
 *
 * Pass a record of variant names to context-free payload schemas
 * (`R = never`) or `null` for unit variants.
 * The decoded type is a discriminated union on `type`.
 *
 * @param variants Record of variant names to schemas or null.
 * @param options.unitEncoding `"serde"` (default): unit variants encode as
 *   bare strings. `"bcs"`: unit variants encode as `{ Key: [] }`.
 */
export const TypedVariant = <V extends Record<string, Schema.Schema.All | null>, Mode extends 'serde' | 'bcs' = 'serde'>(
  variants: V,
  options?: { unitEncoding: Mode },
): Schema.Schema<
  {
    [K in keyof V & string]: V[K] extends Schema.Schema.All ? { readonly type: K; readonly value: Schema.Schema.Type<V[K]> } : { readonly type: K };
  }[keyof V & string],
  VariantEncoded<V, Mode>
> => {
  const bcsMode = options?.unitEncoding === 'bcs';

  const fail = (ast: Transformation, actual: unknown, message: string) => ParseResult.fail(new ParseResult.Type(ast, actual, message));

  return Schema.transformOrFail(KeyedVariantSchema, TypedVariantSchema, {
    strict: false,

    decode: (kv, _options, ast) => {
      // Serde mode: bare string for unit variants
      if (typeof kv === 'string') {
        if (!(kv in variants)) return fail(ast, kv, `Unknown variant "${kv}"`);
        if (variants[kv] !== null) return fail(ast, kv, `Variant "${kv}" expects data`);
        return ParseResult.succeed({ type: kv });
      }

      const keys = Object.keys(kv);
      if (keys.length !== 1) {
        return fail(ast, kv, `Expected exactly one key, got ${keys.length}`);
      }

      const type = keys[0]!;
      if (!(type in variants)) return fail(ast, kv, `Unknown variant "${type}"`);

      const schema = variants[type];

      // BCS mode: { Key: [] } for unit variants
      if (schema === null || schema === undefined) {
        return ParseResult.succeed({ type });
      }

      const decoded = ParseResult.decodeUnknownEither(schema as Schema.Schema.AnyNoContext)(kv[type]);
      if (Either.isLeft(decoded)) return ParseResult.fail(decoded.left);
      return ParseResult.succeed({ type, value: decoded.right });
    },

    encode: (tv, _options, ast) => {
      const { type, value } = tv;
      if (!(type in variants)) return fail(ast, tv, `Unknown variant "${type}"`);

      const schema = variants[type];
      if (schema === null || schema === undefined) {
        return ParseResult.succeed(bcsMode ? { [type]: [] } : type);
      }

      const encoded = ParseResult.encodeUnknownEither(schema as Schema.Schema.AnyNoContext)(value);
      if (Either.isLeft(encoded)) return ParseResult.fail(encoded.left);
      return ParseResult.succeed({ [type]: encoded.right });
    },
  }) as never;
};
