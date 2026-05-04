import { describe, expect, it } from 'vitest';
import { AmountFromRpc, BalanceFromRpc } from '../../../src/base/rpc.ts';
import { decodeSync, encodeSync } from '../helpers.ts';

describe('AmountFromRpc (RPC wire form: lowercase hex, no 0x, no sign)', () => {
  it('decodes lowercase hex', () => {
    expect(decodeSync(AmountFromRpc, 'ff')).toBe(255n);
    expect(decodeSync(AmountFromRpc, 'deadbeef')).toBe(0xdeadbeefn);
  });

  it('rejects uppercase hex', () => {
    expect(() => decodeSync(AmountFromRpc, 'FF')).toThrow();
  });

  it('rejects 0x prefix', () => {
    expect(() => decodeSync(AmountFromRpc, '0xff')).toThrow();
  });

  it('rejects negative input (Amount is unsigned)', () => {
    expect(() => decodeSync(AmountFromRpc, '-1')).toThrow();
  });

  it('encodes back to lowercase hex', () => {
    const decoded = decodeSync(AmountFromRpc, 'abcd');
    expect(encodeSync(AmountFromRpc, decoded)).toBe('abcd');
  });
});

describe('BalanceFromRpc (RPC wire form: lowercase hex, no 0x, signed allowed)', () => {
  it('decodes lowercase positive hex', () => {
    expect(decodeSync(BalanceFromRpc, 'ff')).toBe(255n);
  });

  it('decodes lowercase negative hex', () => {
    expect(decodeSync(BalanceFromRpc, '-ff')).toBe(-255n);
  });

  it('rejects uppercase hex', () => {
    expect(() => decodeSync(BalanceFromRpc, 'FF')).toThrow();
  });

  it('round-trips negative', () => {
    const decoded = decodeSync(BalanceFromRpc, '-1f4');
    expect(encodeSync(BalanceFromRpc, decoded)).toBe('-1f4');
  });
});
