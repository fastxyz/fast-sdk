import { bech32m } from 'bech32';
import { describe, expect, it } from 'vitest';
import {
  AddressFromBcs,
  AddressFromInput,
  AddressFromRest,
  AddressFromRpc,
  AmountFromBcs,
  AmountFromInput,
  AmountFromRest,
  AmountFromRpc,
  BalanceFromBcs,
  BalanceFromRest,
  BalanceFromRpc,
  ClaimDataFromBcs,
  ClaimDataFromRpc,
  NetworkIdFromBcs,
  NonceFromBcs,
  NonceFromRpc,
  SignatureFromBcs,
  SignatureFromRpc,
  StateFromBcs,
  StateKeyFromBcs,
  TokenIdFromBcs,
  TokenIdFromRpc,
  UserDataFromBcs,
  UserDataFromRpc,
} from '../../../src/base/index.ts';
import { bytes32, bytes64, decodeSync, encodeSync, numArray32, numArray64 } from '../helpers.ts';

const ADDR_BYTES = bytes32(0xab);
const ADDR_NUMS = numArray32(0xab);
const ADDR_HEX = 'ab'.repeat(32);
const ADDR_BECH32 = bech32m.encode('fast', bech32m.toWords(ADDR_BYTES));

const SIG_BYTES = bytes64(0xcd);
const SIG_NUMS = numArray64(0xcd);

describe('Address codecs', () => {
  it('AddressFromRpc: number[32] → Uint8Array32', () => {
    const result = decodeSync(AddressFromRpc, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromRpc: encodes back to number[]', () => {
    const decoded = decodeSync(AddressFromRpc, ADDR_NUMS);
    const encoded = encodeSync(AddressFromRpc, decoded);
    expect(encoded).toEqual(ADDR_NUMS);
  });

  it('AddressFromRest: bech32m → Uint8Array32', () => {
    const result = decodeSync(AddressFromRest, ADDR_BECH32);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromBcs: number[32] → Uint8Array32', () => {
    const result = decodeSync(AddressFromBcs, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromInput: accepts hex string', () => {
    const result = decodeSync(AddressFromInput, ADDR_HEX);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromInput: accepts Uint8Array', () => {
    const result = decodeSync(AddressFromInput, ADDR_BYTES);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromInput: accepts number[]', () => {
    const result = decodeSync(AddressFromInput, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromInput: accepts bech32m', () => {
    const result = decodeSync(AddressFromInput, ADDR_BECH32);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('AddressFromInput: rejects wrong length', () => {
    expect(() => decodeSync(AddressFromInput, 'abcd')).toThrow();
  });

  it('all codecs decode to same value', () => {
    const fromRpc = decodeSync(AddressFromRpc, ADDR_NUMS);
    const fromRest = decodeSync(AddressFromRest, ADDR_BECH32);
    const fromBcs = decodeSync(AddressFromBcs, ADDR_NUMS);
    const fromInput = decodeSync(AddressFromInput, ADDR_HEX);
    expect(fromRpc).toEqual(fromRest);
    expect(fromRest).toEqual(fromBcs);
    expect(fromBcs).toEqual(fromInput);
  });
});

describe('Amount codecs', () => {
  it('AmountFromRpc: hex string → bigint', () => {
    expect(decodeSync(AmountFromRpc, 'ff')).toBe(255n);
  });

  it('AmountFromRpc: round-trips', () => {
    const decoded = decodeSync(AmountFromRpc, '3e8');
    expect(decoded).toBe(1000n);
    const encoded = encodeSync(AmountFromRpc, decoded);
    expect(encoded).toBe('3e8');
  });

  it('AmountFromRest: decimal string → bigint', () => {
    expect(decodeSync(AmountFromRest, '1000')).toBe(1000n);
  });

  it('AmountFromBcs: number → bigint', () => {
    expect(decodeSync(AmountFromBcs, 1000)).toBe(1000n);
  });

  it('AmountFromBcs: bigint → bigint', () => {
    expect(decodeSync(AmountFromBcs, 1000n)).toBe(1000n);
  });

  it('AmountFromInput: accepts number', () => {
    expect(decodeSync(AmountFromInput, 42)).toBe(42n);
  });

  it('AmountFromInput: accepts bigint', () => {
    expect(decodeSync(AmountFromInput, 42n)).toBe(42n);
  });
});

describe('Balance codecs (signed)', () => {
  it('BalanceFromRpc: positive hex', () => {
    expect(decodeSync(BalanceFromRpc, '3e8')).toBe(1000n);
  });

  it('BalanceFromRpc: negative hex', () => {
    expect(decodeSync(BalanceFromRpc, '-3e8')).toBe(-1000n);
  });

  it('BalanceFromRest: negative decimal', () => {
    expect(decodeSync(BalanceFromRest, '-1000')).toBe(-1000n);
  });

  it('BalanceFromBcs: negative bigint', () => {
    expect(decodeSync(BalanceFromBcs, -500n)).toBe(-500n);
  });
});

describe('Nonce codecs', () => {
  it('NonceFromRpc: number → bigint', () => {
    expect(decodeSync(NonceFromRpc, 42)).toBe(42n);
  });

  it('NonceFromRpc: bigint → bigint', () => {
    expect(decodeSync(NonceFromRpc, 42n)).toBe(42n);
  });

  it('NonceFromBcs: number → bigint', () => {
    expect(decodeSync(NonceFromBcs, 5)).toBe(5n);
  });
});

describe('Signature codecs', () => {
  it('SignatureFromRpc: number[64] → Uint8Array64', () => {
    const result = decodeSync(SignatureFromRpc, SIG_NUMS);
    expect(result).toEqual(SIG_BYTES);
  });

  it('SignatureFromBcs: number[64] → Uint8Array64', () => {
    const result = decodeSync(SignatureFromBcs, SIG_NUMS);
    expect(result).toEqual(SIG_BYTES);
  });

  it('rejects wrong length (63)', () => {
    expect(() => decodeSync(SignatureFromRpc, new Array(63).fill(0))).toThrow();
  });
});

describe('TokenId / StateKey / State codecs', () => {
  it('TokenIdFromRpc: number[32] → Uint8Array32', () => {
    const result = decodeSync(TokenIdFromRpc, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('TokenIdFromBcs: number[32] → Uint8Array32', () => {
    const result = decodeSync(TokenIdFromBcs, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('StateKeyFromBcs: number[32] → Uint8Array32', () => {
    const result = decodeSync(StateKeyFromBcs, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('StateFromBcs: number[32] → Uint8Array32', () => {
    const result = decodeSync(StateFromBcs, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });
});

describe('ClaimData codecs (variable length)', () => {
  it('ClaimDataFromBcs: number[] → Uint8Array', () => {
    const result = decodeSync(ClaimDataFromBcs, [1, 2, 3]);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('ClaimDataFromRpc: number[] → Uint8Array', () => {
    const result = decodeSync(ClaimDataFromRpc, [10, 20, 30]);
    expect(result).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('handles empty array', () => {
    const result = decodeSync(ClaimDataFromBcs, []);
    expect(result).toEqual(new Uint8Array(0));
  });
});

describe('UserData codecs', () => {
  it('UserDataFromBcs: null → null', () => {
    expect(decodeSync(UserDataFromBcs, null)).toBeNull();
  });

  it('UserDataFromBcs: number[32] → Uint8Array32', () => {
    const result = decodeSync(UserDataFromBcs, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });

  it('UserDataFromRpc: null → null', () => {
    expect(decodeSync(UserDataFromRpc, null)).toBeNull();
  });

  it('UserDataFromRpc: number[32] → Uint8Array32', () => {
    const result = decodeSync(UserDataFromRpc, ADDR_NUMS);
    expect(result).toEqual(ADDR_BYTES);
  });
});

describe('NetworkId', () => {
  for (const id of ['fast:localnet', 'fast:devnet', 'fast:testnet', 'fast:mainnet']) {
    it(`accepts "${id}"`, () => {
      expect(decodeSync(NetworkIdFromBcs, id)).toBe(id);
    });
  }

  it('rejects invalid network', () => {
    expect(() => decodeSync(NetworkIdFromBcs, 'fast:invalid')).toThrow();
  });
});
