import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  BigIntFromNumberOrSelf,
  BigIntFromNumberOrStringOrSelf,
  DecimalBigInt,
  DecimalIntBigInt,
  DecimalUintBigInt,
  HexBigInt,
  HexIntBigInt,
  HexLowerBigInt,
  HexLowerIntBigInt,
  HexLowerUintBigInt,
  HexNumber,
  HexUintBigInt,
  IntBigInt,
  IntBigIntFromNumberOrSelf,
  IntNumber,
  UintBigInt,
  UintBigIntFromNumberOrSelf,
  UintBigIntFromNumberOrStringOrSelf,
  UintNumber,
} from '../../../src/util/numeric.ts';
import { Uint64, Uint256, Int320, HexUint64, DecimalUint256 } from '../../../src/util/instances.ts';
import { decodeSync, encodeSync } from '../helpers.ts';

describe('HexBigInt', () => {
  it('decodes positive hex', () => {
    expect(decodeSync(HexBigInt, 'ff')).toBe(255n);
  });

  it('decodes negative hex', () => {
    expect(decodeSync(HexBigInt, '-1f4')).toBe(-500n);
  });

  it('decodes zero', () => {
    expect(decodeSync(HexBigInt, '0')).toBe(0n);
  });

  it('encodes positive bigint to hex', () => {
    expect(encodeSync(HexBigInt, 255n)).toBe('ff');
  });

  it('encodes negative bigint to hex', () => {
    expect(encodeSync(HexBigInt, -500n)).toBe('-1f4');
  });

  it('round-trips', () => {
    const decoded = decodeSync(HexBigInt, 'deadbeef');
    const encoded = encodeSync(HexBigInt, decoded);
    expect(encoded).toBe('deadbeef');
  });
});

describe('HexNumber', () => {
  it('decodes hex to number', () => {
    expect(decodeSync(HexNumber, 'ff')).toBe(255);
  });

  it('encodes number to hex', () => {
    expect(encodeSync(HexNumber, 255)).toBe('ff');
  });
});

describe('DecimalBigInt', () => {
  it('decodes decimal string to bigint', () => {
    expect(decodeSync(DecimalBigInt, '12345')).toBe(12345n);
  });

  it('encodes bigint to decimal string', () => {
    expect(encodeSync(DecimalBigInt, 12345n)).toBe('12345');
  });
});

describe('BigIntFromNumberOrStringOrSelf', () => {
  it('converts number to bigint', () => {
    expect(decodeSync(BigIntFromNumberOrStringOrSelf, 42)).toBe(42n);
  });

  it('passes through bigint', () => {
    expect(decodeSync(BigIntFromNumberOrStringOrSelf, 42n)).toBe(42n);
  });

  it('converts decimal string to bigint', () => {
    expect(decodeSync(BigIntFromNumberOrStringOrSelf, '1776156806387000000')).toBe(1776156806387000000n);
  });

  it('encodes bigint back to bigint', () => {
    expect(encodeSync(BigIntFromNumberOrStringOrSelf, 42n)).toBe(42n);
  });
});

describe('UintNumber', () => {
  const U8 = UintNumber(8);

  it('accepts 0', () => {
    expect(decodeSync(U8, 0)).toBe(0);
  });

  it('accepts 255', () => {
    expect(decodeSync(U8, 255)).toBe(255);
  });

  it('rejects -1', () => {
    expect(() => decodeSync(U8, -1)).toThrow();
  });

  it('rejects 256', () => {
    expect(() => decodeSync(U8, 256)).toThrow();
  });

  it('rejects non-integer', () => {
    expect(() => decodeSync(U8, 1.5)).toThrow();
  });
});

describe('IntNumber', () => {
  const I32 = IntNumber(32);

  it('accepts 0', () => {
    expect(decodeSync(I32, 0)).toBe(0);
  });

  it('accepts min (-2^31)', () => {
    expect(decodeSync(I32, -2147483648)).toBe(-2147483648);
  });

  it('accepts max (2^31 - 1)', () => {
    expect(decodeSync(I32, 2147483647)).toBe(2147483647);
  });

  it('rejects below min', () => {
    expect(() => decodeSync(I32, -2147483649)).toThrow();
  });

  it('rejects above max', () => {
    expect(() => decodeSync(I32, 2147483648)).toThrow();
  });
});

describe('UintBigInt', () => {
  const U64 = UintBigInt(64);

  it('accepts 0n', () => {
    expect(decodeSync(U64, 0n)).toBe(0n);
  });

  it('accepts max (2^64 - 1)', () => {
    expect(decodeSync(U64, 2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
  });

  it('rejects -1n', () => {
    expect(() => decodeSync(U64, -1n)).toThrow();
  });

  it('rejects overflow (2^64)', () => {
    expect(() => decodeSync(U64, 2n ** 64n)).toThrow();
  });
});

describe('IntBigInt', () => {
  const I320 = IntBigInt(320);

  it('accepts 0n', () => {
    expect(decodeSync(I320, 0n)).toBe(0n);
  });

  it('accepts min (-2^319)', () => {
    expect(decodeSync(I320, -(2n ** 319n))).toBe(-(2n ** 319n));
  });

  it('accepts max (2^319 - 1)', () => {
    expect(decodeSync(I320, 2n ** 319n - 1n)).toBe(2n ** 319n - 1n);
  });

  it('rejects below min', () => {
    expect(() => decodeSync(I320, -(2n ** 319n) - 1n)).toThrow();
  });

  it('rejects above max', () => {
    expect(() => decodeSync(I320, 2n ** 319n)).toThrow();
  });
});

describe('HexUintBigInt', () => {
  const HexU256 = HexUintBigInt(256);

  it('decodes hex to unsigned bigint', () => {
    expect(decodeSync(HexU256, 'ff')).toBe(255n);
  });

  it('rejects negative hex', () => {
    expect(() => decodeSync(HexU256, '-1')).toThrow();
  });

  it('round-trips max value', () => {
    const max = 2n ** 256n - 1n;
    const encoded = encodeSync(HexU256, max);
    expect(decodeSync(HexU256, encoded)).toBe(max);
  });
});

describe('DecimalUintBigInt / DecimalIntBigInt', () => {
  const DecU256 = DecimalUintBigInt(256);
  const DecI320 = DecimalIntBigInt(320);

  it('decodes decimal string to unsigned bigint', () => {
    expect(decodeSync(DecU256, '1000')).toBe(1000n);
  });

  it('rejects negative decimal for unsigned', () => {
    expect(() => decodeSync(DecU256, '-1')).toThrow();
  });

  it('decodes negative decimal for signed', () => {
    expect(decodeSync(DecI320, '-1000')).toBe(-1000n);
  });
});

describe('UintBigIntFromNumberOrStringOrSelf', () => {
  const U64 = UintBigIntFromNumberOrStringOrSelf(64);

  it('converts number to bigint', () => {
    expect(decodeSync(U64, 42)).toBe(42n);
  });

  it('passes through bigint', () => {
    expect(decodeSync(U64, 42n)).toBe(42n);
  });

  it('rejects out-of-range number', () => {
    expect(() => decodeSync(U64, -1)).toThrow();
  });
});

describe('Predefined instances', () => {
  it('Uint64 accepts max', () => {
    expect(decodeSync(Uint64, 2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
  });

  it('Uint256 accepts zero', () => {
    expect(decodeSync(Uint256, 0n)).toBe(0n);
  });

  it('Int320 accepts negative', () => {
    expect(decodeSync(Int320, -1000n)).toBe(-1000n);
  });

  it('HexUint64 round-trips max', () => {
    const max = 2n ** 64n - 1n;
    const hex = encodeSync(HexUint64, max);
    expect(decodeSync(HexUint64, hex)).toBe(max);
  });

  it('DecimalUint256 round-trips', () => {
    const val = 999999999999999999n;
    const dec = encodeSync(DecimalUint256, val);
    expect(decodeSync(DecimalUint256, dec)).toBe(val);
  });
});

describe('HexLowerBigInt', () => {
  it('decodes lowercase hex', () => {
    expect(decodeSync(HexLowerBigInt, 'ff')).toBe(255n);
    expect(decodeSync(HexLowerBigInt, 'deadbeef')).toBe(0xdeadbeefn);
  });

  it('rejects uppercase hex', () => {
    expect(() => decodeSync(HexLowerBigInt, 'FF')).toThrow(/lowercase hex/);
    expect(() => decodeSync(HexLowerBigInt, 'DeadBeef')).toThrow(/lowercase hex/);
  });

  it('rejects 0x prefix', () => {
    expect(() => decodeSync(HexLowerBigInt, '0xff')).toThrow(/lowercase hex/);
  });

  it('rejects empty string', () => {
    expect(() => decodeSync(HexLowerBigInt, '')).toThrow(/lowercase hex/);
  });

  it('decodes negative lowercase hex', () => {
    expect(decodeSync(HexLowerBigInt, '-1f4')).toBe(-500n);
  });

  it('encodes bigint as lowercase hex', () => {
    expect(encodeSync(HexLowerBigInt, 0xabcdn)).toBe('abcd');
    expect(encodeSync(HexLowerBigInt, -500n)).toBe('-1f4');
  });

  it('round-trips', () => {
    const decoded = decodeSync(HexLowerBigInt, 'deadbeef');
    expect(encodeSync(HexLowerBigInt, decoded)).toBe('deadbeef');
  });
});

describe('HexLowerUintBigInt', () => {
  it('rejects negative input', () => {
    const HexLowerUint64 = HexLowerUintBigInt(64);
    expect(() => decodeSync(HexLowerUint64, '-1')).toThrow();
  });

  it('accepts in-range positive', () => {
    const HexLowerUint64 = HexLowerUintBigInt(64);
    expect(decodeSync(HexLowerUint64, 'ff')).toBe(255n);
  });
});

describe('HexLowerIntBigInt', () => {
  it('accepts negative input', () => {
    const HexLowerInt64 = HexLowerIntBigInt(64);
    expect(decodeSync(HexLowerInt64, '-ff')).toBe(-255n);
  });
});

describe('BigIntFromNumberOrSelf (strict — no string)', () => {
  it('accepts bigint passthrough', () => {
    expect(decodeSync(BigIntFromNumberOrSelf, 42n)).toBe(42n);
  });

  it('accepts number', () => {
    expect(decodeSync(BigIntFromNumberOrSelf, 42)).toBe(42n);
  });

  it('rejects string (this is the wire-fidelity contract for REST)', () => {
    expect(() => decodeSync(BigIntFromNumberOrSelf, '42')).toThrow();
  });
});

describe('UintBigIntFromNumberOrSelf', () => {
  it('rejects negative number', () => {
    const u = UintBigIntFromNumberOrSelf(64);
    expect(() => decodeSync(u, -1)).toThrow();
  });

  it('rejects out-of-range', () => {
    const u = UintBigIntFromNumberOrSelf(8);
    expect(() => decodeSync(u, 256)).toThrow();
  });

  it('accepts in-range bigint', () => {
    const u = UintBigIntFromNumberOrSelf(64);
    expect(decodeSync(u, 100n)).toBe(100n);
  });
});

describe('IntBigIntFromNumberOrSelf', () => {
  it('accepts negative number', () => {
    const i = IntBigIntFromNumberOrSelf(64);
    expect(decodeSync(i, -1)).toBe(-1n);
  });

  it('accepts in-range bigint', () => {
    const i = IntBigIntFromNumberOrSelf(64);
    expect(decodeSync(i, -100n)).toBe(-100n);
  });
});

describe('Union fall-through (item #10a)', () => {
  it('HexBigInt failure in a Union does not block the next branch', () => {
    const tolerantHex = Schema.Union(HexBigInt, Schema.Literal('fallback'));
    // 'fallback' is not valid hex — the HexBigInt branch must FAIL CLEANLY
    // (return ParseError) rather than throw, so the Literal branch can succeed.
    expect(decodeSync(tolerantHex, 'fallback')).toBe('fallback');
  });

  it('BigIntFromNumberOrStringOrSelf failure in a Union does not block the next branch', () => {
    // BigInt('not-a-number') would throw SyntaxError under Schema.transform,
    // short-circuiting the Union. Under transformOrFail it returns ParseError,
    // letting Union fall through to the literal branch.
    const tolerant = Schema.Union(BigIntFromNumberOrStringOrSelf, Schema.Literal('skip'));
    expect(decodeSync(tolerant, 'skip')).toBe('skip');
  });
});
