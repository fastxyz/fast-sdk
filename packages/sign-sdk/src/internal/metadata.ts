// Copyright (c) Pi Squared, Inc.
// SPDX-License-Identifier: Apache-2.0

export const MAX_METADATA_TEXT_BYTES = 256;

function isForbiddenControl(codePoint: number): boolean {
  return (codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isFrozenWhitespace(codePoint: number): boolean {
  return (
    (codePoint >= 0x09 && codePoint <= 0x0d) ||
    codePoint === 0x20 ||
    codePoint === 0x85 ||
    codePoint === 0xa0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

const textEncoder = new TextEncoder();

export function assertWellFormedUtf16(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new Error("metadata text contains an unpaired UTF-16 surrogate");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("metadata text contains an unpaired UTF-16 surrogate");
    }
  }
}

export function validateMetadataTextV1(value: string): void {
  assertWellFormedUtf16(value);
  if (textEncoder.encode(value).length > MAX_METADATA_TEXT_BYTES) {
    throw new Error(`metadata text exceeds ${MAX_METADATA_TEXT_BYTES} UTF-8 bytes`);
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (isForbiddenControl(codePoint)) throw new Error("metadata text contains a control character");
    if (codePoint === 0xfeff) throw new Error("metadata text contains U+FEFF");
  }
}

export function hasVisibleMetadataTextV1(value: string): boolean {
  if (value.length === 0) return false;
  for (const character of value) {
    if (!isFrozenWhitespace(character.codePointAt(0)!)) return true;
  }
  return false;
}
