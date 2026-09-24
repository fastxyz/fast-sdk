// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Fast Sign's deliberately small canonical-JSON codec, mirrored from the Rust core. */

export type CanonicalValue =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "uint-string"; value: string };

export type CanonicalValueKind = CanonicalValue["kind"];

export interface CanonicalFieldSpec {
  readonly key: string;
  readonly kind: CanonicalValueKind;
}

export type CanonicalField = readonly [key: string, value: CanonicalValue];

export type CanonicalJsonErrorCode =
  | "INPUT_TOO_LARGE"
  | "BOM"
  | "INVALID_UTF8"
  | "MALFORMED_JSON"
  | "TRAILING_BYTES"
  | "ROOT_NOT_OBJECT"
  | "DUPLICATE_KEY"
  | "UNKNOWN_KEY"
  | "NULL_VALUE"
  | "NON_CANONICAL"
  | "UNPAIRED_SURROGATE";

export class CanonicalJsonError extends Error {
  constructor(
    readonly code: CanonicalJsonErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_JSON_DEPTH = 128;

function fail(code: CanonicalJsonErrorCode, message: string): never {
  throw new CanonicalJsonError(code, message);
}

function assertWellFormedUtf16(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
        fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
    }
  }
}

function isCanonicalUint(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(value);
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, "0");
}

export function escapeCanonicalJsonString(value: string): string {
  assertWellFormedUtf16(value);
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    switch (codePoint) {
      case 0x22:
        out += "\\\"";
        break;
      case 0x5c:
        out += "\\\\";
        break;
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      default:
        out += codePoint <= 0x1f ? `\\u${hex4(codePoint)}` : character;
    }
  }
  return out;
}

export function encodeCanonicalObject(fields: readonly CanonicalField[]): Uint8Array {
  if (!Array.isArray(fields)) fail("NON_CANONICAL", "canonical fields must be an array");
  const seen = new Set<string>();
  let out = "{\n";
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!Array.isArray(field) || field.length !== 2) {
      fail("NON_CANONICAL", "canonical field must be a two-item array");
    }
    const [key, value] = field;
    if (typeof key !== "string") fail("NON_CANONICAL", "canonical field key must be a string");
    if (!value || typeof value !== "object") {
      fail("NON_CANONICAL", "canonical field value must be an object");
    }
    if (value.kind !== "string" && value.kind !== "uint-string" && value.kind !== "bool") {
      fail("NON_CANONICAL", "unsupported canonical JSON value type");
    }
    if (value.kind === "string" && typeof value.value !== "string") {
      fail("NON_CANONICAL", "canonical string value must be a string");
    }
    if (value.kind === "uint-string" && typeof value.value !== "string") {
      fail("NON_CANONICAL", "canonical unsigned integer value must be a string");
    }
    if (value.kind === "bool" && typeof value.value !== "boolean") {
      fail("NON_CANONICAL", "canonical boolean value must be a boolean");
    }
    if (seen.has(key)) fail("DUPLICATE_KEY", `duplicate JSON key: ${key}`);
    seen.add(key);
    if (value.kind === "uint-string" && !isCanonicalUint(value.value)) {
      fail("NON_CANONICAL", "unsigned integer must be a canonical ASCII decimal string");
    }

    out += `  "${escapeCanonicalJsonString(key)}": `;
    switch (value.kind) {
      case "string":
      case "uint-string":
        out += `"${escapeCanonicalJsonString(value.value)}"`;
        break;
      case "bool":
        out += value.value ? "true" : "false";
        break;
      default:
        fail("NON_CANONICAL", "unsupported canonical JSON value type");
    }
    if (index + 1 !== fields.length) out += ",";
    out += "\n";
  }
  out += "}";
  return encoder.encode(out);
}

class JsonCursor {
  position = 0;

  constructor(readonly text: string) {}

  skipWhitespace(): void {
    while (
      this.position < this.text.length &&
      [" ", "\t", "\n", "\r"].includes(this.text[this.position]!)
    ) {
      this.position += 1;
    }
  }

  parseValue(depth = 0): void {
    if (depth > MAX_JSON_DEPTH) fail("MALFORMED_JSON", "JSON nesting exceeds codec limit");
    this.skipWhitespace();
    const current = this.text[this.position];
    if (current === '"') this.parseStringSyntax();
    else if (current === "{") this.parseObjectSyntax(depth + 1);
    else if (current === "[") this.parseArraySyntax(depth + 1);
    else if (current === "t") this.consumeKeyword("true");
    else if (current === "f") this.consumeKeyword("false");
    else if (current === "n") this.consumeKeyword("null");
    else if (current === "-" || (current !== undefined && current >= "0" && current <= "9")) {
      this.parseNumber();
    } else {
      fail("MALFORMED_JSON", "invalid JSON value");
    }
  }

  // NOTE: parseStringDecoded (semantic pass) and parseStringSyntax (syntax
  // pass) must recognize exactly the same escape language: the same short
  // escapes '"\\/bfnrt', the same \uXXXX form, and the same surrogate-pairing
  // rule. If one accepted an escape the other rejected, an input could pass
  // the complete-syntax pass and then fail (or vice versa) with a misleading
  // class. Any edit to one switch must be mirrored in the other.
  parseStringDecoded(): string {
    if (this.text[this.position] !== '"') fail("MALFORMED_JSON", "expected JSON string");
    this.position += 1;
    let out = "";
    while (this.position < this.text.length) {
      const current = this.text[this.position++]!;
      const unit = current.charCodeAt(0);
      if (current === '"') {
        assertWellFormedUtf16(out);
        return out;
      }
      if (unit <= 0x1f) fail("MALFORMED_JSON", "raw control in JSON string");
      if (current !== "\\") {
        out += current;
        continue;
      }
      const escape = this.text[this.position++];
      switch (escape) {
        case '"':
        case "\\":
        case "/":
          out += escape;
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const first = this.readHexCodeUnit();
          if (first >= 0xd800 && first <= 0xdbff) {
            if (this.text.slice(this.position, this.position + 2) !== "\\u") {
              fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
            }
            this.position += 2;
            const second = this.readHexCodeUnit();
            if (second < 0xdc00 || second > 0xdfff) {
              fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
            }
            out += String.fromCodePoint(
              0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00),
            );
          } else if (first >= 0xdc00 && first <= 0xdfff) {
            fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
          } else {
            out += String.fromCharCode(first);
          }
          break;
        }
        default:
          fail("MALFORMED_JSON", "invalid JSON escape");
      }
    }
    fail("MALFORMED_JSON", "unterminated JSON string");
  }

  private readHexCodeUnit(): number {
    const digits = this.text.slice(this.position, this.position + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail("MALFORMED_JSON", "invalid Unicode escape");
    this.position += 4;
    return Number.parseInt(digits, 16);
  }

  // NOTE: kept escape-for-escape consistent with parseStringDecoded above;
  // see the comment there before changing either.
  private parseStringSyntax(): void {
    if (this.text[this.position] !== '"') fail("MALFORMED_JSON", "expected JSON string");
    this.position += 1;
    while (this.position < this.text.length) {
      const current = this.text[this.position++]!;
      if (current === '"') return;
      if (current.charCodeAt(0) <= 0x1f) fail("MALFORMED_JSON", "raw control in JSON string");
      if (current !== "\\") continue;
      const escape = this.text[this.position++];
      if (escape === "u") {
        const first = this.readHexCodeUnit();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.text.slice(this.position, this.position + 2) !== "\\u") {
            fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
          }
          this.position += 2;
          const second = this.readHexCodeUnit();
          if (second < 0xdc00 || second > 0xdfff) {
            fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
          }
        } else if (first >= 0xdc00 && first <= 0xdfff) {
          fail("UNPAIRED_SURROGATE", "canonical JSON contains an unpaired UTF-16 surrogate");
        }
      } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
        fail("MALFORMED_JSON", "invalid JSON escape");
      }
    }
    fail("MALFORMED_JSON", "unterminated JSON string");
  }

  private parseObjectSyntax(depth: number): void {
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "}") {
      this.position += 1;
      return;
    }
    while (true) {
      this.parseStringSyntax();
      this.skipWhitespace();
      if (this.text[this.position++] !== ":") fail("MALFORMED_JSON", "expected colon");
      this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.text[this.position++];
      if (separator === "}") return;
      if (separator !== ",") fail("MALFORMED_JSON", "expected comma or object end");
      this.skipWhitespace();
    }
  }

  private parseArraySyntax(depth: number): void {
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return;
    }
    while (true) {
      this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.text[this.position++];
      if (separator === "]") return;
      if (separator !== ",") fail("MALFORMED_JSON", "expected comma or array end");
    }
  }

  private consumeKeyword(keyword: string): void {
    if (this.text.slice(this.position, this.position + keyword.length) !== keyword) {
      fail("MALFORMED_JSON", "invalid JSON keyword");
    }
    this.position += keyword.length;
  }

  private parseNumber(): void {
    const rest = this.text.slice(this.position);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (!match) fail("MALFORMED_JSON", "invalid JSON number");
    this.position += match[0].length;
  }
}

export type RawValue =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "other" };

/**
 * Fold a JSON object's top-level key/value pairs in source order, rejecting a
 * duplicated key (`DUPLICATE_KEY`) and any non string/bool/null value
 * (`NON_CANONICAL`). Exposed so the AAv2 shape probe can reuse the SAME
 * duplicate detection and raw `schema` read the strict decoder uses — keeping
 * the probe's precedence (duplicate_key > unsupported_schema) in lockstep with
 * the decoder. Assumes syntax/trailing were already validated by the caller.
 */
export function parseRawObject(text: string, allowOtherValues = false): Array<[string, RawValue]> {
  const cursor = new JsonCursor(text);
  cursor.skipWhitespace();
  if (text[cursor.position++] !== "{") fail("ROOT_NOT_OBJECT", "canonical JSON root is not an object");
  cursor.skipWhitespace();
  const fields: Array<[string, RawValue]> = [];
  const seen = new Set<string>();
  // Early return for "{}" leaves the cursor ON the closing brace without
  // consuming it. That is safe because this cursor is discarded on return:
  // trailing-input validation already happened in decodeCanonicalObject's
  // first complete-syntax pass, which does consume the whole value.
  if (text[cursor.position] === "}") return fields;
  while (true) {
    const key = cursor.parseStringDecoded();
    if (seen.has(key)) fail("DUPLICATE_KEY", `duplicate JSON key: ${key}`);
    seen.add(key);
    cursor.skipWhitespace();
    if (text[cursor.position++] !== ":") fail("MALFORMED_JSON", "expected colon");
    cursor.skipWhitespace();
    let value: RawValue;
    if (text[cursor.position] === '"') {
      value = { kind: "string", value: cursor.parseStringDecoded() };
    } else if (text.slice(cursor.position, cursor.position + 4) === "true") {
      cursor.position += 4;
      value = { kind: "bool", value: true };
    } else if (text.slice(cursor.position, cursor.position + 5) === "false") {
      cursor.position += 5;
      value = { kind: "bool", value: false };
    } else if (text.slice(cursor.position, cursor.position + 4) === "null") {
      cursor.position += 4;
      value = { kind: "null" };
    } else if (allowOtherValues) {
      cursor.parseValue();
      value = { kind: "other" };
    } else {
      fail("NON_CANONICAL", `value for ${key} has the wrong JSON type`);
    }
    fields.push([key, value]);
    cursor.skipWhitespace();
    const separator = text[cursor.position++];
    if (separator === "}") return fields;
    if (separator !== ",") fail("MALFORMED_JSON", "expected comma or object end");
    cursor.skipWhitespace();
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

export function decodeCanonicalObject(
  bytes: Uint8Array,
  expected: readonly CanonicalFieldSpec[],
  maxBytes: number,
): CanonicalValue[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    // Caller misuse, not hostile input: an invalid bound must not surface as
    // a CanonicalJsonError that a verifier could classify like NON_CANONICAL.
    throw new TypeError("canonical JSON byte bound must be a non-negative safe integer");
  }
  if (bytes.length > maxBytes) fail("INPUT_TOO_LARGE", `canonical JSON exceeds ${maxBytes} bytes`);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("BOM", "UTF-8 BOM is not permitted");
  }

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    fail("INVALID_UTF8", "canonical JSON is not valid UTF-8");
  }

  const syntax = new JsonCursor(text);
  syntax.skipWhitespace();
  const rootPosition = syntax.position;
  syntax.parseValue();
  syntax.skipWhitespace();
  if (syntax.position !== text.length) fail("TRAILING_BYTES", "trailing bytes after JSON value");
  if (text[rootPosition] !== "{") fail("ROOT_NOT_OBJECT", "canonical JSON root is not an object");

  const raw = parseRawObject(text);
  for (const [key] of raw) {
    if (!expected.some((field) => field.key === key)) fail("UNKNOWN_KEY", `unknown JSON key: ${key}`);
  }
  if (
    raw.length !== expected.length ||
    raw.some(([key], index) => key !== expected[index]?.key)
  ) {
    fail("NON_CANONICAL", "object keys do not match the required set and order");
  }

  const values: CanonicalValue[] = raw.map(([key, rawValue], index) => {
    const field = expected[index]!;
    if (rawValue.kind === "null") fail("NULL_VALUE", `JSON null is not permitted for key: ${key}`);
    if (field.kind === "bool" && rawValue.kind === "bool") {
      return { kind: "bool", value: rawValue.value };
    }
    if (field.kind === "string" && rawValue.kind === "string") {
      return { kind: "string", value: rawValue.value };
    }
    if (field.kind === "uint-string" && rawValue.kind === "string") {
      if (!isCanonicalUint(rawValue.value)) {
        fail("NON_CANONICAL", "unsigned integer must be a canonical ASCII decimal string");
      }
      return { kind: "uint-string", value: rawValue.value };
    }
    fail("NON_CANONICAL", `value for ${key} has the wrong JSON type`);
  });

  const canonical = encodeCanonicalObject(
    expected.map((field, index) => [field.key, values[index]!] as const),
  );
  if (!equalBytes(canonical, bytes)) {
    fail("NON_CANONICAL", "input does not equal its canonical re-encoding");
  }
  return values;
}
