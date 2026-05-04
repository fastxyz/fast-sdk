import { ParseResult, Schema } from 'effect';

/** Decodes a decimal string into a `bigint` and encodes back. Built-in. */
export const DecimalBigInt = Schema.BigInt;

/**
 * Decodes a signed hex string (no `0x` prefix) into a `bigint` and encodes back.
 *
 * Negative values use a `-` prefix: `"-1f4"` decodes to `-500n`.
 */
export const HexBigInt = Schema.transformOrFail(Schema.String, Schema.BigIntFromSelf, {
  strict: true,
  decode: (s, _opts, ast) => {
    const sign = s[0] === '-' ? -1n : 1n;
    const digits = s[0] === '-' ? s.slice(1) : s;
    if (digits.length === 0 || !/^[0-9a-fA-F]+$/.test(digits)) {
      return ParseResult.fail(new ParseResult.Type(ast, s, `Invalid hex string: "${s}"`));
    }
    return ParseResult.succeed(sign * BigInt(`0x${digits}`));
  },
  encode: (n) => ParseResult.succeed(n.toString(16)),
});

/** Decodes a decimal string into a `number` and encodes back. Built-in. */
export const DecimalNumber = Schema.NumberFromString;

/** Decodes a hex string (no `0x` prefix) into a `number` and encodes back. */
export const HexNumber = Schema.transformOrFail(Schema.String, Schema.Number, {
  strict: true,
  decode: (s, _opts, ast) => {
    if (s.length === 0 || !/^[0-9a-fA-F]+$/.test(s)) {
      return ParseResult.fail(new ParseResult.Type(ast, s, `Invalid hex string: "${s}"`));
    }
    return ParseResult.succeed(Number(`0x${s}`));
  },
  encode: (n) => ParseResult.succeed(n.toString(16)),
});

/**
 * Upcasts a `number | bigint | string` to `bigint`.
 *
 * Useful when JSON may contain either representation for the same field.
 * Accepts strings to support JSON transports that serialize BigInt as
 * decimal strings (e.g. Chrome extension port.postMessage).
 */
export const BigIntFromNumberOrStringOrSelf = Schema.transformOrFail(
  Schema.Union(Schema.Number, Schema.BigIntFromSelf, Schema.String),
  Schema.BigIntFromSelf,
  {
    strict: true,
    decode: (n, _opts, ast) => {
      try {
        return ParseResult.succeed(typeof n === 'bigint' ? n : BigInt(n));
      } catch (e) {
        return ParseResult.fail(new ParseResult.Type(ast, n, `Cannot convert to bigint: ${String(e)}`));
      }
    },
    encode: (n) => ParseResult.succeed(n),
  },
);

/** Branded unsigned integer `number` with range `0 .. 2^bits - 1`. */
export const UintNumber = <N extends number>(bits: N) =>
  Schema.Number.pipe(Schema.int(), Schema.between(0, 2 ** bits - 1), Schema.brand(`Uint${bits}` as `Uint${N}`));

/** Branded signed integer `number` with range `-2^(bits-1) .. 2^(bits-1) - 1`. */
export const IntNumber = <N extends number>(bits: N) =>
  Schema.Number.pipe(Schema.int(), Schema.between(-(2 ** (bits - 1)), 2 ** (bits - 1) - 1), Schema.brand(`Int${bits}` as `Int${N}`));

/** Branded unsigned integer `bigint` with range `0 .. 2^bits - 1`. */
export const UintBigInt = <N extends number>(bits: N) =>
  Schema.BigIntFromSelf.pipe(Schema.betweenBigInt(0n, 2n ** BigInt(bits) - 1n), Schema.brand(`Uint${bits}` as `Uint${N}`));

/** Branded signed integer `bigint` with range `-2^(bits-1) .. 2^(bits-1) - 1`. */
export const IntBigInt = <N extends number>(bits: N) =>
  Schema.BigIntFromSelf.pipe(Schema.betweenBigInt(-(2n ** BigInt(bits - 1)), 2n ** BigInt(bits - 1) - 1n), Schema.brand(`Int${bits}` as `Int${N}`));

/** Hex string to branded unsigned bigint. */
export const HexUintBigInt = <N extends number>(bits: N) => Schema.compose(HexBigInt, UintBigInt(bits));

/** Hex string to branded signed bigint. */
export const HexIntBigInt = <N extends number>(bits: N) => Schema.compose(HexBigInt, IntBigInt(bits));

/** Decimal string to branded unsigned bigint. */
export const DecimalUintBigInt = <N extends number>(bits: N) => Schema.compose(DecimalBigInt, UintBigInt(bits));

/** Decimal string to branded signed bigint. */
export const DecimalIntBigInt = <N extends number>(bits: N) => Schema.compose(DecimalBigInt, IntBigInt(bits));

/** number | bigint to branded unsigned bigint. */
export const UintBigIntFromNumberOrStringOrSelf = <N extends number>(bits: N) => Schema.compose(BigIntFromNumberOrStringOrSelf, UintBigInt(bits));

/** number | bigint to branded signed bigint. */
export const IntBigIntFromNumberOrStringOrSelf = <N extends number>(bits: N) => Schema.compose(BigIntFromNumberOrStringOrSelf, IntBigInt(bits));

/**
 * Strict lowercase hex variant of `HexBigInt`.
 *
 * Enforces `^-?[0-9a-f]+$` — the exact form emitted by Rust's `to_str_radix(16)`
 * over the legacy JSON-RPC wire. Use in `RpcPalette` where wire-fidelity matters.
 * For tolerant user-input parsing, use `HexBigInt`.
 */
export const HexLowerBigInt = Schema.transformOrFail(Schema.String, Schema.BigIntFromSelf, {
  strict: true,
  decode: (s, _opts, ast) => {
    const sign = s[0] === '-' ? -1n : 1n;
    const digits = s[0] === '-' ? s.slice(1) : s;
    if (digits.length === 0 || !/^[0-9a-f]+$/.test(digits)) {
      return ParseResult.fail(new ParseResult.Type(ast, s, `Invalid lowercase hex string: "${s}"`));
    }
    return ParseResult.succeed(sign * BigInt(`0x${digits}`));
  },
  encode: (n) => ParseResult.succeed(n.toString(16)),
});

/** Strict-lowercase hex string to branded unsigned bigint. */
export const HexLowerUintBigInt = <N extends number>(bits: N) =>
  Schema.compose(HexLowerBigInt, UintBigInt(bits));

/** Strict-lowercase hex string to branded signed bigint. */
export const HexLowerIntBigInt = <N extends number>(bits: N) =>
  Schema.compose(HexLowerBigInt, IntBigInt(bits));

/**
 * Upcasts a `number | bigint` to `bigint`.
 *
 * Strict counterpart to `BigIntFromNumberOrStringOrSelf` — rejects string
 * input. Use in `RestPalette` (wire-faithful: REST never emits stringified
 * bigints; only `TransportPalette` accepts the post-`String(bigint)` form).
 */
export const BigIntFromNumberOrSelf = Schema.transformOrFail(
  Schema.Union(Schema.Number, Schema.BigIntFromSelf),
  Schema.BigIntFromSelf,
  {
    strict: true,
    decode: (n) => ParseResult.succeed(typeof n === 'bigint' ? n : BigInt(n)),
    encode: (n) => ParseResult.succeed(n),
  },
);

/** number | bigint to branded unsigned bigint. */
export const UintBigIntFromNumberOrSelf = <N extends number>(bits: N) =>
  Schema.compose(BigIntFromNumberOrSelf, UintBigInt(bits));

/** number | bigint to branded signed bigint. */
export const IntBigIntFromNumberOrSelf = <N extends number>(bits: N) =>
  Schema.compose(BigIntFromNumberOrSelf, IntBigInt(bits));
