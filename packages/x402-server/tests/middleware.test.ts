/**
 * Tests for x402-server middleware
 */

import { describe, it, afterEach, expect } from 'vitest';
import { paymentMiddleware, paywall } from '../src/middleware.js';

const originalFetch = globalThis.fetch;

// Network configs for testing (no hardcoded defaults in the SDK)
const ARBITRUM_SEPOLIA_CONFIG = {
  asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  decimals: 6,
  extra: { name: 'USD Coin', version: '2' },
};

const BASE_SEPOLIA_CONFIG = {
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  decimals: 6,
  extra: { name: 'USD Coin', version: '2' },
};

const FAST_TESTNET_CONFIG = {
  asset: '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46',
  decimals: 6,
};

// Mock request
function mockRequest(path: string, method: string = 'GET', headers: Record<string, string> = {}): {
  method: string;
  path: string;
  header: (name: string) => string | undefined;
} {
  return {
    method,
    path,
    header: (name: string) => headers[name],
  };
}

// Mock response
interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

function mockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

describe('x402-server middleware', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('paymentMiddleware', () => {
    describe('route matching', () => {
      it('should pass through unprotected routes', async () => {
        const middleware = paymentMiddleware(
          '0x123',
          { 'GET /api/protected': { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/public');
        const res = mockResponse();
        let nextCalled = false;

        await middleware(req, res, () => { nextCalled = true; });

        expect(nextCalled).toBe(true);
      });

      it('should match exact path', async () => {
        const middleware = paymentMiddleware(
          '0x123',
          { '/api/data': { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/data');
        const res = mockResponse();

        await middleware(req, res, () => {});

        expect(res.statusCode).toBe(402);
      });

      it('should match wildcard path', async () => {
        const middleware = paymentMiddleware(
          '0x123',
          { '/api/premium/*': { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/premium/data/nested');
        const res = mockResponse();

        await middleware(req, res, () => {});

        expect(res.statusCode).toBe(402);
      });

      it('should match method + path', async () => {
        const middleware = paymentMiddleware(
          '0x123',
          { 'POST /api/generate': { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const postReq = mockRequest('/api/generate', 'POST');
        const postRes = mockResponse();
        await middleware(postReq, postRes, () => {});
        expect(postRes.statusCode).toBe(402);

        const getReq = mockRequest('/api/generate', 'GET');
        const getRes = mockResponse();
        let nextCalled = false;
        await middleware(getReq, getRes, () => { nextCalled = true; });
        expect(nextCalled).toBe(true);
      });
    });

    describe('402 response', () => {
      it('should return 402 when no X-PAYMENT header', async () => {
        const middleware = paymentMiddleware(
          '0x123',
          { '/api/data': { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/data');
        const res = mockResponse();

        await middleware(req, res, () => {});

        expect(res.statusCode).toBe(402);
        const body = res.body as { error: string; accepts: unknown[] };
        expect(body.error).toContain('X-PAYMENT');
        expect(Array.isArray(body.accepts)).toBe(true);
      });

      it('should include payment requirements in 402', async () => {
        const middleware = paymentMiddleware(
          '0xPaymentAddress123',
          { '/api/data': { price: '$0.50', network: 'base-sepolia', networkConfig: BASE_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/data');
        const res = mockResponse();

        await middleware(req, res, () => {});

        const body = res.body as { accepts: Array<{ payTo: string; maxAmountRequired: string; network: string }> };
        expect(body.accepts[0].payTo).toBe('0xPaymentAddress123');
        expect(body.accepts[0].maxAmountRequired).toBe('500000');
        expect(body.accepts[0].network).toBe('base-sepolia');
      });
    });

    describe('multi-address support', () => {
      it('should use EVM address for EVM network', async () => {
        const middleware = paymentMiddleware(
          { evm: '0xEvmAddress', fast: 'fast1FastAddress' },
          { '/api/evm': { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/evm');
        const res = mockResponse();

        await middleware(req, res, () => {});

        const body = res.body as { accepts: Array<{ payTo: string }> };
        expect(body.accepts[0].payTo).toBe('0xEvmAddress');
      });

      it('should use Fast address for Fast network', async () => {
        const middleware = paymentMiddleware(
          { evm: '0xEvmAddress', fast: 'fast1FastAddress' },
          { '/api/fast': { price: '$0.10', network: 'fast-testnet', networkConfig: FAST_TESTNET_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/fast');
        const res = mockResponse();

        await middleware(req, res, () => {});

        const body = res.body as { accepts: Array<{ payTo: string }> };
        expect(body.accepts[0].payTo).toBe('fast1FastAddress');
      });

      it('should error if address not configured for network', async () => {
        const middleware = paymentMiddleware(
          { evm: '0xEvmAddress' },
          { '/api/fast': { price: '$0.10', network: 'fast-testnet', networkConfig: FAST_TESTNET_CONFIG } },
          { url: 'http://localhost:4020' }
        );

        const req = mockRequest('/api/fast');
        const res = mockResponse();

        await middleware(req, res, () => {});

        expect(res.statusCode).toBe(500);
        const body = res.body as { error: string };
        expect(body.error).toContain('Fast payment address not configured');
      });
    });
  });

  describe('paywall', () => {
    it('should create middleware for all routes', async () => {
      const middleware = paywall(
        '0x123',
        { price: '$0.10', network: 'arbitrum-sepolia', networkConfig: ARBITRUM_SEPOLIA_CONFIG },
        { url: 'http://localhost:4020' }
      );

      const req = mockRequest('/any/path/here');
      const res = mockResponse();

      await middleware(req, res, () => {});

      expect(res.statusCode).toBe(402);
    });
  });
});
