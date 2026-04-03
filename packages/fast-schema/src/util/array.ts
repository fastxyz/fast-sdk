import { bech32m, type Decoded } from 'bech32';
import { ParseResult, Schema } from 'effect';

/** Decodes a `number[]` into a `Uint8Array` and encodes back. */
export const Uint8ArrayFromNumberArray = Schema.transform(Schema.Array(Schema.Number), Schema.Uint8ArrayFromSelf, {
  strict: true,
  decode: (arr) => new Uint8Array(arr),
  encode: (buf) => Array.from(buf),
});

/** Decodes a base64 string into a `Uint8Array` and encodes back. Built-in. */
export const Uint8ArrayFromBase64 = Schema.Uint8ArrayFromBase64;

/** Decodes a hex string into a `Uint8Array` and encodes back. Built-in. */
export const Uint8ArrayFromHex = Schema.Uint8ArrayFromHex;

/** Strips optional `0x` prefix from a hex string. */
export const Strip0xHex = Schema.transform(Schema.String, Schema.String, {
  strict: true,
  decode: (s) => (s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s),
  encode: (s) => s,
});

/** Decodes a hex string (with optional `0x` prefix) into a `Uint8Array`. */
export const Uint8ArrayFromHexOptional0x = Schema.compose(Strip0xHex, Uint8ArrayFromHex);

/**
 * Decodes a bech32m string into a `Uint8Array` and encodes back.
 *
 * Returns a schema parameterized by a human-readable prefix (hrp).
 * Decoding validates the prefix matches; encoding always uses the given hrp.
 *
 * @param hrp - The expected bech32m human-readable prefix (e.g. `"fast"`).
 */
export const Uint8ArrayFromBech32m = (hrp: string) =>
  Schema.transformOrFail(Schema.String, Schema.Uint8ArrayFromSelf, {
    strict: true,
    decode: (encoded, _options, ast) => {
      let result: Decoded;
      try {
        result = bech32m.decode(encoded);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const message = `Failed to decode bech32m: ${error}`;
        const failure = new ParseResult.Type(ast, encoded, message);
        return ParseResult.fail(failure);
      }

      const prefix = result.prefix;
      const words = result.words;
      if (prefix !== hrp) {
        const message = `Expected bech32m prefix "${hrp}", got "${prefix}"`;
        const failure = new ParseResult.Type(ast, encoded, message);
        return ParseResult.fail(failure);
      }

      const array = new Uint8Array(bech32m.fromWords(words));
      return ParseResult.succeed(array);
    },
    encode: (data, _options, ast) => {
      let words: number[];
      try {
        words = bech32m.toWords(data);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const message = `Failed to encode bech32m: ${error}`;
        const inner = new ParseResult.Type(ast, data, message);
        const failure = new ParseResult.Transformation(ast, data, 'Transformation', inner);
        return ParseResult.fail(failure);
      }
      return ParseResult.succeed(bech32m.encode(hrp, words));
    },
  });

/**
 * Creates a `Uint8Array` schema that enforces exactly `n` bytes.
 *
 * effect/Schema has no built-in Uint8Array length filter
 * (`itemsCount` is for `ReadonlyArray`, `length` is for `string`).
 */
export const FixedUint8Array = <N extends number>(n: N) =>
  Schema.Uint8ArrayFromSelf.pipe(
    Schema.filter((a) => a.length === n, {
      message: () => `Expected exactly ${n} bytes`,
    }),
    Schema.brand(`Uint8Array${n}` as `Uint8Array${N}`),
  );

/** Decodes a `number[n]` into a fixed-length `Uint8Array(n)` and encodes back. */
export const FixedUint8ArrayFromNumberArray = <N extends number>(n: N) => Schema.compose(Uint8ArrayFromNumberArray, FixedUint8Array(n));

/** Decodes a hex string into a fixed-length `Uint8Array(n)` and encodes back. */
export const FixedUint8ArrayFromHex = <N extends number>(n: N) => Schema.compose(Uint8ArrayFromHex, FixedUint8Array(n));

/** Decodes a hex string (with optional `0x` prefix) into a fixed-length `Uint8Array(n)`. */
export const FixedUint8ArrayFromHexOptional0x = <N extends number>(n: N) => Schema.compose(Uint8ArrayFromHexOptional0x, FixedUint8Array(n));
