import { describe, it, expect } from 'vitest';
import { Address, encodeAddressToBech32m, decodeAddressFromBech32m } from '../src/address';

describe('Address', () => {
  it('encodes Uint8Array to string', () => {
    const bytes = new Uint8Array(32).fill(0x42);
    const encoded = encodeAddressToBech32m(bytes);
    expect(encoded).toMatch(/^fast/);
  });

  it('decodes string back to bytes', () => {
    const original = new Uint8Array(32).fill(0xAB);
    const encoded = encodeAddressToBech32m(original);
    const decoded = decodeAddressFromBech32m(encoded);
    expect(decoded).toEqual(original);
  });

  it('Address class roundtrip', () => {
    const bytes = new Uint8Array(32).fill(0xCD);
    const address = new Address(bytes);
    const bech32m = address.toString();
    const restored = Address.fromString(bech32m);
    expect(restored.bytes).toEqual(bytes);
  });

  it('Address.bytes returns the stored bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    const address = new Address(bytes);
    expect(address.bytes).toEqual(bytes);
  });

  it('Address.toArray converts bytes to number array', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const address = new Address(bytes);
    expect(address.toArray()).toEqual([1, 2, 3, 4]);
  });
});

