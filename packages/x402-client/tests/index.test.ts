/**
 * Tests for x402-client main functions
 */

import { describe, it, afterEach, expect } from 'vitest';
import { 
  x402Pay, 
  parse402Response, 
  buildPaymentHeader, 
  parsePaymentHeader,
} from '../src/index.js';
import { mockEvmWallet, mockFastWallet, mock402Response, createMockFetch } from './helpers.js';

const originalFetch = globalThis.fetch;

describe('x402-client', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('buildPaymentHeader / parsePaymentHeader', () => {
    it('should encode and decode payment payload', () => {
      const payload = {
        x402Version: 1,
        scheme: 'exact',
        network: 'arbitrum-sepolia',
        payload: { signature: '0x123', authorization: { from: '0xabc' } },
      };

      const encoded = buildPaymentHeader(payload);
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = parsePaymentHeader(encoded);
      expect(decoded).toEqual(payload);
    });

    it('should handle complex nested objects', () => {
      const payload = {
        nested: { deep: { value: [1, 2, 3] } },
        unicode: '日本語',
      };

      const encoded = buildPaymentHeader(payload);
      const decoded = parsePaymentHeader(encoded);
      expect(decoded).toEqual(payload);
    });
  });

  describe('parse402Response', () => {
    it('should parse a 402 response', async () => {
      const mockResponse = new Response(JSON.stringify(mock402Response('arbitrum-sepolia')), {
        status: 402,
      });

      const result = await parse402Response(mockResponse);
      expect(result.x402Version).toBe(1);
      expect(Array.isArray(result.accepts)).toBe(true);
      expect(result.accepts![0].network).toBe('arbitrum-sepolia');
    });

    it('should throw for non-402 response', async () => {
      const mockResponse = new Response('OK', { status: 200 });

      await expect(parse402Response(mockResponse)).rejects.toThrow(/Expected 402 response/);
    });
  });

  describe('x402Pay', () => {
    it('should return success for non-402 response', async () => {
      globalThis.fetch = createMockFetch([
        { status: 200, body: { data: 'free content' } },
      ]);

      const result = await x402Pay({
        url: 'https://api.example.com/free',
        wallet: mockEvmWallet,
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ data: 'free content' });
      expect(result.payment).toBeUndefined();
      expect(result.note).toContain('without payment');
    });

    it('should throw if no payment requirements in 402', async () => {
      globalThis.fetch = createMockFetch([
        { status: 402, body: { error: 'Payment required', accepts: [] } },
      ]);

      await expect(
        x402Pay({
          url: 'https://api.example.com/paid',
          wallet: mockEvmWallet,
        })
      ).rejects.toThrow(/No payment requirements/);
    });

    it('should throw if no matching wallet for network', async () => {
      globalThis.fetch = createMockFetch([
        { status: 402, body: mock402Response('arbitrum-sepolia') },
      ]);

      await expect(
        x402Pay({
          url: 'https://api.example.com/paid',
          wallet: mockFastWallet,
        })
      ).rejects.toThrow(/No matching wallet/);
    });

    it('should accept array of wallets', async () => {
      globalThis.fetch = createMockFetch([
        { status: 200, body: { data: 'content' } },
      ]);

      const result = await x402Pay({
        url: 'https://api.example.com/data',
        wallet: [mockEvmWallet, mockFastWallet],
      });

      expect(result.success).toBe(true);
    });

    it('should include logs when verbose=true', async () => {
      globalThis.fetch = createMockFetch([
        { status: 200, body: { data: 'content' } },
      ]);

      const result = await x402Pay({
        url: 'https://api.example.com/data',
        wallet: mockEvmWallet,
        verbose: true,
      });

      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.logs!.length).toBeGreaterThan(0);
      expect(result.logs!.some(log => log.includes('x402Pay START'))).toBe(true);
    });

    it('should not include logs when verbose=false', async () => {
      globalThis.fetch = createMockFetch([
        { status: 200, body: { data: 'content' } },
      ]);

      const result = await x402Pay({
        url: 'https://api.example.com/data',
        wallet: mockEvmWallet,
        verbose: false,
      });

      expect(result.logs).toBeUndefined();
    });

    it('should pass custom headers', async () => {
      let customHeaderValue: string | undefined;
      let authHeaderValue: string | undefined;
      
      globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        customHeaderValue = headers?.['X-Custom'];
        authHeaderValue = headers?.['Authorization'];
        return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
      };

      await x402Pay({
        url: 'https://api.example.com/data',
        wallet: mockEvmWallet,
        headers: { 'X-Custom': 'value', 'Authorization': 'Bearer token' },
      });

      expect(customHeaderValue).toBe('value');
      expect(authHeaderValue).toBe('Bearer token');
    });

    it('should handle different HTTP methods', async () => {
      let capturedMethod: string | undefined;
      
      globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
      };

      await x402Pay({
        url: 'https://api.example.com/data',
        method: 'POST',
        wallet: mockEvmWallet,
      });

      expect(capturedMethod).toBe('POST');
    });
  });
});
