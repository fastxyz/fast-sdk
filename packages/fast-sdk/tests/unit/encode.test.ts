import { bcs } from '@mysten/bcs';
import { describe, expect, it } from 'vitest';
import { domainEncode, encode, getTokenId, hash, hashHex } from '../../src/index';

const TestStruct = bcs.struct('TestStruct', {
  value: bcs.u64(),
});

describe('encode', () => {
  it('serializes a u64 value to bytes', async () => {
    const result = await encode(bcs.u64(), 42n);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('serializes a struct to bytes', async () => {
    const result = await encode(TestStruct, { value: 100n });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces deterministic output', async () => {
    const a = await encode(bcs.u64(), 999n);
    const b = await encode(bcs.u64(), 999n);
    expect(a).toEqual(b);
  });

  it('produces different output for different values', async () => {
    const a = await encode(bcs.u64(), 1n);
    const b = await encode(bcs.u64(), 2n);
    expect(a).not.toEqual(b);
  });
});

describe('domainEncode', () => {
  it('prepends SchemaName:: prefix', async () => {
    const result = await domainEncode(TestStruct, { value: 42n });
    const prefix = new TextEncoder().encode('TestStruct::');
    const prefixSlice = result.slice(0, prefix.length);
    expect(prefixSlice).toEqual(prefix);
  });

  it('is longer than plain encode by prefix length', async () => {
    const plain = await encode(TestStruct, { value: 42n });
    const domain = await domainEncode(TestStruct, { value: 42n });
    const prefixLen = new TextEncoder().encode('TestStruct::').length;
    expect(domain.length).toBe(plain.length + prefixLen);
  });

  it('trailing bytes match plain encode', async () => {
    const plain = await encode(TestStruct, { value: 42n });
    const domain = await domainEncode(TestStruct, { value: 42n });
    const prefixLen = new TextEncoder().encode('TestStruct::').length;
    expect(domain.slice(prefixLen)).toEqual(plain);
  });
});

describe('hash', () => {
  it('returns 32-byte keccak-256 hash', async () => {
    const result = await hash(bcs.u64(), 42n);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toHaveLength(32);
  });

  it('produces deterministic output', async () => {
    const a = await hash(bcs.u64(), 42n);
    const b = await hash(bcs.u64(), 42n);
    expect(a).toEqual(b);
  });

  it('produces different hashes for different values', async () => {
    const a = await hash(bcs.u64(), 1n);
    const b = await hash(bcs.u64(), 2n);
    expect(a).not.toEqual(b);
  });
});

describe('hashHex', () => {
  it('returns 0x-prefixed hex string', async () => {
    const result = await hashHex(bcs.u64(), 42n);
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('matches hash output as hex', async () => {
    const rawHash = await hash(bcs.u64(), 42n);
    const hexHash = await hashHex(bcs.u64(), 42n);
    const expected =
      '0x' +
      Array.from(rawHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    expect(hexHash).toBe(expected);
  });
});

describe('getTokenId', () => {
  it('returns 32-byte deterministic token ID', () => {
    const sender = new Uint8Array(32).fill(1);
    const result = getTokenId(sender, 0n, 0n);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toHaveLength(32);
  });

  it('is deterministic', () => {
    const sender = new Uint8Array(32).fill(1);
    const a = getTokenId(sender, 5n, 0n);
    const b = getTokenId(sender, 5n, 0n);
    expect(a).toEqual(b);
  });

  it('differs by sender', () => {
    const a = getTokenId(new Uint8Array(32).fill(1), 0n, 0n);
    const b = getTokenId(new Uint8Array(32).fill(2), 0n, 0n);
    expect(a).not.toEqual(b);
  });

  it('differs by nonce', () => {
    const sender = new Uint8Array(32).fill(1);
    const a = getTokenId(sender, 0n, 0n);
    const b = getTokenId(sender, 1n, 0n);
    expect(a).not.toEqual(b);
  });

  it('differs by operation index', () => {
    const sender = new Uint8Array(32).fill(1);
    const a = getTokenId(sender, 0n, 0n);
    const b = getTokenId(sender, 0n, 1n);
    expect(a).not.toEqual(b);
  });
});
