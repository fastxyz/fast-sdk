/**
 * Tests for x402-server payment functions
 */

import { describe, it, afterEach, expect } from 'vitest';
import {
  createPaymentRequirement,
  createPaymentRequired,
  parsePaymentHeader,
  encodePaymentResponse,
} from '../src/payment.js';

const originalFetch = globalThis.fetch;

// Network configs for testing
const ARBITRUM_SEPOLIA_CONFIG = {
  asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  decimals: 6,
  extra: { name: 'USD Coin', version: '2' } as Record<string, unknown>,
};

const FAST_TESTNET_CONFIG = {
  asset: '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46',
  decimals: 6,
};

describe('x402-server payment', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('createPaymentRequirement', () => {
    it('should create EVM payment requirement', () => {
      const req = createPaymentRequirement(
        '0x1234567890abcdef1234567890abcdef12345678',
        { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG },
        '/api/data'
      );

      expect(req.scheme).toBe('exact');
      expect(req.network).toBe('arbitrum-sepolia');
      expect(req.maxAmountRequired).toBe('100000');
      expect(req.payTo).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(req.resource).toBe('/api/data');
      expect(req.maxTimeoutSeconds).toBe(60);
      expect(req.asset).toMatch(/^0x/);
      expect(req.extra).toBeTruthy();
      expect(req.extra!.name).toBe('USD Coin');
    });

    it('should create Fast payment requirement', () => {
      const req = createPaymentRequirement(
        'fast1abc123xyz',
        { price: '$0.01', network: 'fast-testnet', networkConfig: FAST_TESTNET_CONFIG },
        '/api/fast-data'
      );

      expect(req.scheme).toBe('exact');
      expect(req.network).toBe('fast-testnet');
      expect(req.maxAmountRequired).toBe('10000');
      expect(req.payTo).toBe('fast1abc123xyz');
      expect(req.extra).toBeUndefined();
    });

    it('should use custom description', () => {
      const req = createPaymentRequirement(
        '0x123',
        { 
          price: '$0.10', 
          network: 'arbitrum-sepolia',
          networkConfig: ARBITRUM_SEPOLIA_CONFIG,
          config: { description: 'Premium weather data' }
        },
        '/api/weather'
      );

      expect(req.description).toBe('Premium weather data');
    });

    it('should use custom asset address', () => {
      const customAsset = '0xcustomtoken123';
      const req = createPaymentRequirement(
        '0x123',
        { 
          price: '$0.10', 
          network: 'arbitrum-sepolia',
          networkConfig: ARBITRUM_SEPOLIA_CONFIG,
          config: { asset: customAsset }
        },
        '/api/data'
      );

      expect(req.asset).toBe(customAsset);
    });
  });

  describe('createPaymentRequired', () => {
    it('should create 402 response body', () => {
      const response = createPaymentRequired(
        '0x123',
        { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG },
        '/api/data'
      );

      expect(response.error).toBe('X-PAYMENT header is required');
      expect(Array.isArray(response.accepts)).toBe(true);
      expect(response.accepts.length).toBe(1);
      expect(response.accepts[0].network).toBe('arbitrum-sepolia');
    });
  });

  describe('parsePaymentHeader', () => {
    it('should decode base64 payment header', () => {
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'arbitrum-sepolia',
        payload: { signature: '0x123' },
      };
      
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const decoded = parsePaymentHeader(encoded);

      expect(decoded).toEqual(payload);
    });
  });

  describe('encodePaymentResponse', () => {
    it('should encode response to base64', () => {
      const response = {
        success: true,
        txHash: '0xabc123',
        network: 'arbitrum-sepolia',
        payer: '0x456',
      };

      const encoded = encodePaymentResponse(response);
      expect(typeof encoded).toBe('string');

      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString());
      expect(decoded).toEqual(response);
    });
  });
});
