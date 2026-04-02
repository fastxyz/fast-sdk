/**
 * Tests for x402-server utilities
 */

import { describe, it, expect } from 'vitest';
import {
  parsePrice,
  getNetworkConfig,
  encodePayload,
  decodePayload,
  NETWORK_CONFIGS,
} from '../../src/server/utils.js';

describe('x402-server utils', () => {
  describe('NETWORK_CONFIGS', () => {
    it('should include Fast networks', () => {
      expect(NETWORK_CONFIGS['fast-testnet']).toBeTruthy();
      expect(NETWORK_CONFIGS['fast-mainnet']).toBeTruthy();
    });

    it('should include EVM networks', () => {
      expect(NETWORK_CONFIGS['arbitrum-sepolia']).toBeTruthy();
      expect(NETWORK_CONFIGS['arbitrum']).toBeTruthy();
      expect(NETWORK_CONFIGS['base-sepolia']).toBeTruthy();
      expect(NETWORK_CONFIGS['base']).toBeTruthy();
    });

    it('should have correct decimals for USDC', () => {
      expect(NETWORK_CONFIGS['arbitrum-sepolia'].decimals).toBe(6);
      expect(NETWORK_CONFIGS['fast-testnet'].decimals).toBe(6);
      expect(NETWORK_CONFIGS['fast-mainnet'].decimals).toBe(6);
    });

    it('should keep the canonical Fast token ids for both Fast networks', () => {
      expect(NETWORK_CONFIGS['fast-testnet'].asset).toBe(
        '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46'
      );
      expect(NETWORK_CONFIGS['fast-mainnet'].asset).toBe(
        '0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130'
      );
    });

    it('should include EIP-712 extra for EVM networks', () => {
      const config = NETWORK_CONFIGS['arbitrum-sepolia'];
      expect(config.extra).toBeTruthy();
      expect(config.extra.name).toBe('USD Coin');
      expect(config.extra.version).toBe('2');
    });

    it('should not include extra for Fast networks', () => {
      const config = NETWORK_CONFIGS['fast-testnet'];
      expect(config.extra).toBeUndefined();
    });
  });

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

  describe('getNetworkConfig', () => {
    it('should return config for known networks', () => {
      const config = getNetworkConfig('arbitrum-sepolia');
      expect(config).toBeTruthy();
      expect(config.decimals).toBe(6);
      expect(config.asset).toMatch(/^0x/);
    });

    it('should return default config for unknown networks', () => {
      const config = getNetworkConfig('unknown-network');
      expect(config).toBeTruthy();
      expect(config.decimals).toBe(6);
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
