import { describe, expect, it } from 'vitest';
import { InvalidAmountError } from '../../src/errors/index.js';
import { formatBaseUnits, parsePositiveAmount } from '../../src/services/amount.js';

describe('formatBaseUnits', () => {
  it('formats exactly and trims trailing zeros', () => {
    expect(formatBaseUnits(100_000n, 6)).toBe('0.1');
    expect(formatBaseUnits(1_000_000n, 6)).toBe('1');
    expect(formatBaseUnits(1n, 6)).toBe('0.000001');
    expect(formatBaseUnits(123_456_789_012_345_678_901n, 18)).toBe('123.456789012345678901');
    expect(formatBaseUnits(42n, 0)).toBe('42');
  });
});

describe('parsePositiveAmount', () => {
  it('parses without float rounding', () => {
    expect(parsePositiveAmount('0.1', 6, 'testUSDC')).toBe(100_000n);
    expect(parsePositiveAmount('10', 6, 'testUSDC')).toBe(10_000_000n);
    expect(parsePositiveAmount('1.000001', 6, 'testUSDC')).toBe(1_000_001n);
    expect(parsePositiveAmount('.5', 2, 'GOLD')).toBe(50n);
    expect(parsePositiveAmount('123456789.123456789123456789', 18, 'BIG')).toBe(123_456_789_123_456_789_123_456_789n);
  });

  it('rejects malformed, non-positive and over-precise amounts', () => {
    expect(() => parsePositiveAmount('1e3', 6, 'testUSDC')).toThrow(InvalidAmountError);
    expect(() => parsePositiveAmount('-1', 6, 'testUSDC')).toThrow(InvalidAmountError);
    expect(() => parsePositiveAmount('0.000', 6, 'testUSDC')).toThrow('Amount must be greater than zero');
    expect(() => parsePositiveAmount('1.5', 0, 'NFT')).toThrow('Amount has too many decimal places for NFT (max 0)');
  });
});
