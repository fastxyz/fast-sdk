import { describe, expect, it } from 'vitest';
import {
  FixedUint8Array,
  FixedUint8ArrayFromHex,
  FixedUint8ArrayFromNumberArray,
  Uint8ArrayFromBech32m,
  Uint8ArrayFromHexOptional0x,
  Uint8ArrayFromNumberArray,
} from '../../../src/util/array.ts';
import { decodeSync, encodeSync } from '../helpers.ts';

describe('Uint8ArrayFromNumberArray', () => {
  it('decodes number[] to Uint8Array', () => {
    const result = decodeSync(Uint8ArrayFromNumberArray, [0, 1, 127, 128, 255]);
    expect(result).toEqual(new Uint8Array([0, 1, 127, 128, 255]));
  });

  it('encodes Uint8Array back to number[]', () => {
    const decoded = decodeSync(Uint8ArrayFromNumberArray, [10, 20]);
    const encoded = encodeSync(Uint8ArrayFromNumberArray, decoded);
    expect(encoded).toEqual([10, 20]);
  });

  it('round-trips', () => {
    const input = [0, 42, 255];
    const decoded = decodeSync(Uint8ArrayFromNumberArray, input);
    const encoded = encodeSync(Uint8ArrayFromNumberArray, decoded);
    expect(encoded).toEqual(input);
  });

  it('handles empty array', () => {
    const result = decodeSync(Uint8ArrayFromNumberArray, []);
    expect(result).toEqual(new Uint8Array(0));
  });
});

describe('Uint8ArrayFromHexOptional0x', () => {
  it('decodes 0x-prefixed hex', () => {
    const result = decodeSync(Uint8ArrayFromHexOptional0x, '0xabcd');
    expect(result).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('decodes 0X-prefixed hex', () => {
    const result = decodeSync(Uint8ArrayFromHexOptional0x, '0Xabcd');
    expect(result).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('decodes bare hex without prefix', () => {
    const result = decodeSync(Uint8ArrayFromHexOptional0x, 'abcd');
    expect(result).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('encodes back to hex without prefix', () => {
    const decoded = decodeSync(Uint8ArrayFromHexOptional0x, '0xabcd');
    const encoded = encodeSync(Uint8ArrayFromHexOptional0x, decoded);
    expect(encoded).toBe('abcd');
  });

  it('throws on invalid hex', () => {
    expect(() => decodeSync(Uint8ArrayFromHexOptional0x, '0xZZZZ')).toThrow();
  });
});

describe('Uint8ArrayFromBech32m', () => {
  const FastAddress = Uint8ArrayFromBech32m('fast');

  it('round-trips 32 bytes through bech32m', () => {
    const bytes = new Uint8Array(32).fill(0xab);
    const encoded = encodeSync(FastAddress, bytes);
    expect(encoded).toMatch(/^fast1/);
    const decoded = decodeSync(FastAddress, encoded);
    expect(decoded).toEqual(bytes);
  });

  it('rejects wrong prefix', () => {
    // Encode with a different prefix
    const { bech32m } = require('bech32');
    const wrongAddr = bech32m.encode('bc', bech32m.toWords(new Uint8Array(20)));
    expect(() => decodeSync(FastAddress, wrongAddr)).toThrow(/prefix/);
  });

  it('rejects garbage input', () => {
    expect(() => decodeSync(FastAddress, 'not-an-address')).toThrow();
  });
});

describe('FixedUint8Array', () => {
  const Fixed32 = FixedUint8Array(32);

  it('accepts exactly 32 bytes', () => {
    const result = decodeSync(Fixed32, new Uint8Array(32).fill(1));
    expect(result).toHaveLength(32);
  });

  it('rejects 31 bytes', () => {
    expect(() => decodeSync(Fixed32, new Uint8Array(31))).toThrow();
  });

  it('rejects 33 bytes', () => {
    expect(() => decodeSync(Fixed32, new Uint8Array(33))).toThrow();
  });
});

describe('FixedUint8ArrayFromNumberArray', () => {
  const Fixed32 = FixedUint8ArrayFromNumberArray(32);

  it('decodes 32-element array to Uint8Array', () => {
    const input = Array.from({ length: 32 }, (_, i) => i);
    const result = decodeSync(Fixed32, input);
    expect(result).toHaveLength(32);
    expect(result[0]).toBe(0);
    expect(result[31]).toBe(31);
  });

  it('rejects 31-element array', () => {
    expect(() => decodeSync(Fixed32, new Array(31).fill(0))).toThrow();
  });

  it('rejects 33-element array', () => {
    expect(() => decodeSync(Fixed32, new Array(33).fill(0))).toThrow();
  });
});

describe('FixedUint8ArrayFromHex', () => {
  const Fixed32 = FixedUint8ArrayFromHex(32);

  it('decodes 64-char hex to 32 bytes', () => {
    const hex = 'ab'.repeat(32);
    const result = decodeSync(Fixed32, hex);
    expect(result).toHaveLength(32);
    expect(result[0]).toBe(0xab);
  });

  it('rejects 62-char hex (31 bytes)', () => {
    const hex = 'ab'.repeat(31);
    expect(() => decodeSync(Fixed32, hex)).toThrow();
  });
});
