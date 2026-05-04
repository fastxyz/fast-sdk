import { describe, expect, it } from 'vitest';
import { AmountFromInput, BalanceFromInput } from '../../../src/base/input.ts';
import { decodeSync } from '../helpers.ts';

// Note on bare-hex (no 0x prefix) inputs: those are NOT currently accepted
// because the first Union branch (`Uint256FromNumberOrStringOrSelf`) calls
// `BigInt(s)` which throws an unhandled `SyntaxError` on hex input, preventing
// the Union from falling through to the hex branch. Fixing that requires
// wrapping the bigint coercion with `transformOrFail` so the throw becomes a
// recoverable ParseError — out of scope for this 0x-tolerance change. Tracked
// as a follow-up item in the cleanup debt list.

describe('AmountFromInput accepts every reasonable user format', () => {
  it('accepts 0x-prefixed lowercase hex', () => {
    expect(decodeSync(AmountFromInput, '0xff')).toBe(255n);
  });

  it('accepts 0x-prefixed uppercase hex', () => {
    expect(decodeSync(AmountFromInput, '0xFF')).toBe(255n);
  });

  it('accepts 0X-prefixed hex', () => {
    expect(decodeSync(AmountFromInput, '0Xff')).toBe(255n);
  });

  it('accepts decimal string', () => {
    expect(decodeSync(AmountFromInput, '255')).toBe(255n);
  });

  it('accepts bigint', () => {
    expect(decodeSync(AmountFromInput, 255n)).toBe(255n);
  });

  it('accepts number', () => {
    expect(decodeSync(AmountFromInput, 255)).toBe(255n);
  });
});

describe('BalanceFromInput accepts 0x-prefixed hex', () => {
  it('accepts 0x-prefixed positive', () => {
    expect(decodeSync(BalanceFromInput, '0xff')).toBe(255n);
  });

  it('accepts decimal negative', () => {
    expect(decodeSync(BalanceFromInput, '-255')).toBe(-255n);
  });
});
