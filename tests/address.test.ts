import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pubkeyToAddress, addressToPubkey } from '../src/address.js';

describe('address', () => {
  describe('pubkeyToAddress', () => {
    it('32 bytes of 0xaa should produce a fast1... address', () => {
      const hex = 'aa'.repeat(32);
      const address = pubkeyToAddress(hex);
      assert.ok(address.startsWith('fast1'), `Expected fast1 prefix, got: ${address}`);
    });

    it('should be deterministic — same input produces same output', () => {
      const hex = 'aa'.repeat(32);
      const first = pubkeyToAddress(hex);
      const second = pubkeyToAddress(hex);
      assert.equal(first, second);
    });

    it('result should be a non-empty string', () => {
      const hex = 'aa'.repeat(32);
      const address = pubkeyToAddress(hex);
      assert.ok(typeof address === 'string' && address.length > 0);
    });
  });

  describe('addressToPubkey', () => {
    it('should decode a known address to a Uint8Array of length 32', () => {
      const hex = 'aa'.repeat(32);
      const address = pubkeyToAddress(hex);
      const bytes = addressToPubkey(address);
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(bytes.length, 32);
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip 0xaa * 32 bytes', () => {
      const hex = 'aa'.repeat(32);
      const address = pubkeyToAddress(hex);
      const bytes = addressToPubkey(address);
      assert.equal(Buffer.from(bytes).toString('hex'), hex);
    });

    it('should roundtrip all-zero bytes', () => {
      const hex = '00'.repeat(32);
      const address = pubkeyToAddress(hex);
      const bytes = addressToPubkey(address);
      assert.equal(Buffer.from(bytes).toString('hex'), hex);
    });

    it('should roundtrip all-0xff bytes', () => {
      const hex = 'ff'.repeat(32);
      const address = pubkeyToAddress(hex);
      const bytes = addressToPubkey(address);
      assert.equal(Buffer.from(bytes).toString('hex'), hex);
    });
  });

  describe('invalid inputs', () => {
    it('should throw on a completely invalid address string', () => {
      assert.throws(() => addressToPubkey('invalid'));
    });

    it('should throw on an empty string', () => {
      assert.throws(() => addressToPubkey(''));
    });
  });
});
