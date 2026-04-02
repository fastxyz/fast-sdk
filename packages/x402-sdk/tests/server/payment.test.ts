/**
 * Tests for x402-server payment functions
 */

import { describe, it, afterEach, expect } from 'vitest';
import {
  createPaymentRequirement,
  createPaymentRequired,
  parsePaymentHeader,
  encodePaymentResponse,
} from '../../src/server/payment.js';

const originalFetch = globalThis.fetch;

describe('x402-server payment', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('createPaymentRequirement', () => {
    it('should create EVM payment requirement', () => {
      const req = createPaymentRequirement(
        '0x1234567890abcdef1234567890abcdef12345678',
        { price: '$0.10', network: 'arbitrum-sepolia' },
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
      expect(req.extra.name).toBe('USD Coin');
    });

    it('should create Fast payment requirement', () => {
      const req = createPaymentRequirement(
        'fast1abc123xyz',
        { price: '$0.01', network: 'fast-testnet' },
        '/api/fast-data'
      );

      expect(req.scheme).toBe('exact');
      expect(req.network).toBe('fast-testnet');
      expect(req.maxAmountRequired).toBe('10000');
      expect(req.payTo).toBe('fast1abc123xyz');
      expect(req.extra).toBeUndefined();
    });

    it('should reject the deprecated Fast network alias', () => {
      expect(() => createPaymentRequirement(
        'fast1abc123xyz',
        { price: '$0.01', network: 'fast' },
        '/api/fast-data'
      )).toThrow(/Unsupported Fast network alias "fast"/);
    });

    it('should use custom description', () => {
      const req = createPaymentRequirement(
        '0x123',
        { 
          price: '$0.10', 
          network: 'arbitrum-sepolia',
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
        { price: '$0.10', network: 'arbitrum-sepolia' },
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
