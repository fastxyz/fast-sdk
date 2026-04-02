/**
 * Tests for x402-server utilities (re-exported from x402-types)
 */

import { describe, it, expect } from 'vitest';
import {
  parsePrice,
  encodePayload,
  decodePayload,
} from '../src/utils.js';

describe('x402-server utils', () => {
  describe('parsePrice', () => {
    it('should parse dollar format', () => {
      expect(parsePrice('$0.10')).toBe('100000');
      expect(parsePrice('$1.00')).toBe('1000000');
      expect(parsePrice('$0.01')).toBe('10000');
    });

    it('should parse decimal format', () => {
      expect(parsePrice('0.10')).toBe('100000');
      expect(parsePrice('1.5')).toBe('1500000');
    });

    it('should parse USDC suffix', () => {
      expect(parsePrice('0.10 USDC')).toBe('100000');
      expect(parsePrice('0.10USDC')).toBe('100000');
      expect(parsePrice('0.10 usdc')).toBe('100000');
    });

    it('should parse raw integer amounts', () => {
      expect(parsePrice('100000')).toBe('100000');
      expect(parsePrice('1000000')).toBe('1000000');
    });

    it('should handle custom decimals', () => {
      expect(parsePrice('1.0', 18)).toBe('1000000000000000000');
      expect(parsePrice('0.5', 8)).toBe('50000000');
    });

    it('should throw for invalid format', () => {
      expect(() => parsePrice('invalid')).toThrow(/Invalid price format/);
      expect(() => parsePrice('abc')).toThrow(/Invalid price format/);
    });
  });

  describe('encodePayload / decodePayload', () => {
    it('should encode and decode JSON payload', () => {
      const payload = { success: true, txHash: '0x123' };
      const encoded = encodePayload(payload);
      
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
      
      const decoded = decodePayload(encoded);
      expect(decoded).toEqual(payload);
    });

    it('should handle complex objects', () => {
      const payload = {
        nested: { deep: { value: [1, 2, 3] } },
        unicode: '日本語',
      };
      
      const encoded = encodePayload(payload);
      const decoded = decodePayload(encoded);
      expect(decoded).toEqual(payload);
    });
  });
});
