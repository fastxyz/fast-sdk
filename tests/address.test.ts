import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bech32m } from 'bech32';

import {
  encodeFastAddress,
  fastAddressToBytes,
  decodeFastAddress,
} from '../src/core/address.js';
import { bytesToHex } from '../src/core/bytes.js';

describe('address', () => {
  describe('encodeFastAddress', () => {
    it('32 bytes of 0xaa should produce a fast1... address', () => {
      const bytes = new Uint8Array(32).fill(0xaa);
      const address = encodeFastAddress(bytes);
      assert.ok(address.startsWith('fast1'), `Expected fast1 prefix, got: ${address}`);
    });

    it('should be deterministic — same input produces same output', () => {
      const bytes = new Uint8Array(32).fill(0xaa);
      const first = encodeFastAddress(bytes);
      const second = encodeFastAddress(bytes);
      assert.equal(first, second);
    });

    it('result should be a non-empty string', () => {
      const bytes = new Uint8Array(32).fill(0xaa);
      const address = encodeFastAddress(bytes);
      assert.ok(typeof address === 'string' && address.length > 0);
    });

    it('throws on non-32-byte public keys', () => {
      assert.throws(
        () => encodeFastAddress(new Uint8Array([0xaa])),
        /32 bytes/,
      );
    });
  });

  describe('decodeFastAddress', () => {
    it('decodes a known address to canonical address plus bytes', () => {
      const expectedBytes = new Uint8Array(32).fill(0xaa);
      const address = encodeFastAddress(expectedBytes);
      const decoded = decodeFastAddress(address);

      assert.equal(decoded.address, address);
      assert.ok(decoded.bytes instanceof Uint8Array);
      assert.equal(decoded.bytes.length, 32);
      assert.equal(bytesToHex(decoded.bytes), bytesToHex(expectedBytes));
    });

    it('canonicalizes mixed-case input', () => {
      const expectedBytes = new Uint8Array(32).fill(0xaa);
      const canonical = encodeFastAddress(expectedBytes);
      const mixedCase = `fAst${canonical.slice(4).toUpperCase()}`;
      const decoded = decodeFastAddress(mixedCase);

      assert.equal(decoded.address, canonical);
      assert.equal(bytesToHex(decoded.bytes), bytesToHex(expectedBytes));
    });

    it('should throw on a completely invalid address string', () => {
      assert.throws(() => decodeFastAddress('invalid'));
    });

    it('should throw on an empty string', () => {
      assert.throws(() => decodeFastAddress(''));
    });

    it('should reject non-fast bech32m prefixes', () => {
      const words = bech32m.toWords(new Uint8Array(32).fill(1));
      const otherAddress = bech32m.encode('evil', words, 90);
      assert.throws(
        () => decodeFastAddress(otherAddress),
        /Invalid Fast address prefix/,
      );
    });

    it('should reject addresses that do not encode 32-byte public keys', () => {
      const words = bech32m.toWords(new Uint8Array([1]));
      const shortAddress = bech32m.encode('fast', words, 90);
      assert.throws(
        () => decodeFastAddress(shortAddress),
        /32 bytes/,
      );
    });
  });

  describe('fastAddressToBytes', () => {
    it('should decode a known address to a Uint8Array of length 32', () => {
      const bytes = new Uint8Array(32).fill(0xaa);
      const address = encodeFastAddress(bytes);
      const decodedBytes = fastAddressToBytes(address);

      assert.ok(decodedBytes instanceof Uint8Array);
      assert.equal(decodedBytes.length, 32);
      assert.equal(bytesToHex(decodedBytes), bytesToHex(bytes));
    });

    it('matches decodeFastAddress(address).bytes', () => {
      const bytes = new Uint8Array(32).fill(0xff);
      const address = encodeFastAddress(bytes);
      const direct = fastAddressToBytes(address);
      const decoded = decodeFastAddress(address).bytes;

      assert.equal(bytesToHex(direct), bytesToHex(decoded));
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip 0xaa * 32 bytes', () => {
      const bytes = new Uint8Array(32).fill(0xaa);
      const address = encodeFastAddress(bytes);
      const decodedBytes = fastAddressToBytes(address);
      assert.equal(bytesToHex(decodedBytes), bytesToHex(bytes));
    });

    it('should roundtrip all-zero bytes', () => {
      const bytes = new Uint8Array(32);
      const address = encodeFastAddress(bytes);
      const decodedBytes = fastAddressToBytes(address);
      assert.equal(bytesToHex(decodedBytes), bytesToHex(bytes));
    });

    it('should roundtrip all-0xff bytes', () => {
      const bytes = new Uint8Array(32).fill(0xff);
      const address = encodeFastAddress(bytes);
      const decodedBytes = fastAddressToBytes(address);
      assert.equal(bytesToHex(decodedBytes), bytesToHex(bytes));
    });
  });
});
