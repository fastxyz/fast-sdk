export interface CanonicalUint {
  readonly uint: string;
}

export type CanonicalField = readonly [
  key: string,
  value: string | boolean | CanonicalUint,
];

const encoder = new TextEncoder();
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/;

export function isCanonicalUint(value: string): boolean {
  return CANONICAL_UINT.test(value);
}

export function uint(value: string): CanonicalUint {
  if (!isCanonicalUint(value)) {
    throw new Error(
      `canonical JSON uint is not a canonical unsigned decimal: ${JSON.stringify(value)}`,
    );
  }
  return { uint: value };
}

function isCanonicalUintValue(
  value: string | boolean | CanonicalUint,
): value is CanonicalUint {
  return typeof value === "object" && value !== null && typeof value.uint === "string";
}

function assertWellFormedUtf16(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        trailing < 0xdc00 ||
        trailing > 0xdfff
      ) {
        throw new Error("canonical JSON contains an unpaired UTF-16 surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("canonical JSON contains an unpaired UTF-16 surrogate");
    }
  }
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, "0");
}

export function escapeCanonicalJsonString(value: string): string {
  assertWellFormedUtf16(value);
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    switch (codePoint) {
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += "\\\\";
        break;
      case 0x08:
        result += "\\b";
        break;
      case 0x09:
        result += "\\t";
        break;
      case 0x0a:
        result += "\\n";
        break;
      case 0x0c:
        result += "\\f";
        break;
      case 0x0d:
        result += "\\r";
        break;
      default:
        result += codePoint <= 0x1f ? `\\u${hex4(codePoint)}` : character;
    }
  }
  return result;
}

export function encodeCanonicalObject(
  fields: readonly CanonicalField[],
): Uint8Array {
  const seen = new Set<string>();
  let result = "{\n";
  fields.forEach(([key, value], index) => {
    if (seen.has(key)) throw new Error(`duplicate canonical JSON key: ${key}`);
    seen.add(key);
    result += `  "${escapeCanonicalJsonString(key)}": `;
    if (typeof value === "boolean") {
      result += value ? "true" : "false";
    } else if (isCanonicalUintValue(value)) {
      if (!isCanonicalUint(value.uint)) {
        throw new Error(
          `canonical JSON uint is not a canonical unsigned decimal: ${JSON.stringify(value.uint)}`,
        );
      }
      result += `"${escapeCanonicalJsonString(value.uint)}"`;
    } else {
      result += `"${escapeCanonicalJsonString(value)}"`;
    }
    if (index + 1 !== fields.length) result += ",";
    result += "\n";
  });
  result += "}";
  return encoder.encode(result);
}
