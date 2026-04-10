/**
 * Tests for the facilitator HTTP server routes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFacilitatorRoutes, createFacilitatorServer } from '../src/server.js';
import type { FacilitatorConfig } from '../src/types.js';

type MockRequest = {
  method: string;
  path: string;
  body?: Record<string, unknown>;
};

type MockResponse = {
  status: (code: number) => MockResponse;
  json: (data: unknown) => void;
  _statusCode: number;
  _body: unknown;
};

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    _statusCode: 200,
    _body: undefined,
    status(code: number) {
      res._statusCode = code;
      return res;
    },
    json(data: unknown) {
      res._body = data;
    },
  };
  return res;
}

function createMockNext() {
  return vi.fn();
}

function findRoute(routes: ReturnType<typeof createFacilitatorRoutes>, method: string, path: string) {
  return routes.find((r) => r.method === method && r.path === path);
}

const testFacilitatorConfig: FacilitatorConfig = {
  fastNetworks: {
    'fast-testnet': {
      rpcUrl: 'https://testnet.api.fast.xyz/proxy',
      committeePublicKeys: ['aabb', 'ccdd', 'eeff'],
    },
  },
  evmChains: {
    'arbitrum-sepolia': {
      chain: {} as any,
      rpcUrl: 'https://arb-sepolia.example.com',
      usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    },
  },
};

describe('createFacilitatorRoutes', () => {
  it('creates routes for /verify, /settle, and /supported', () => {
    const routes = createFacilitatorRoutes(testFacilitatorConfig);
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('post /verify');
    expect(paths).toContain('post /settle');
    expect(paths).toContain('get /supported');
  });

  describe('POST /verify', () => {
    it('returns 400 for missing parameters', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const verifyRoute = findRoute(routes, 'post', '/verify')!;
      const res = createMockResponse();

      await verifyRoute.handler({ body: {} } as any, res as any);

      expect(res._statusCode).toBe(400);
      expect((res._body as any).invalidReason).toBe('missing_parameters');
    });

    it('returns 400 for invalid base64 payload', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const verifyRoute = findRoute(routes, 'post', '/verify')!;
      const res = createMockResponse();

      await verifyRoute.handler({ body: { paymentPayload: 'not-valid-base64!@#$', paymentRequirements: {} } } as any, res as any);

      expect(res._statusCode).toBe(400);
      expect((res._body as any).invalidReason).toBe('invalid_payload_encoding');
    });

    it('accepts object payloads directly', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const verifyRoute = findRoute(routes, 'post', '/verify')!;
      const res = createMockResponse();

      await verifyRoute.handler(
        {
          body: {
            paymentPayload: {
              x402Version: 1,
              scheme: 'exact',
              network: 'solana-mainnet',
              payload: {},
            },
            paymentRequirements: {
              scheme: 'exact',
              network: 'solana-mainnet',
              maxAmountRequired: '100000',
              resource: '/api',
              description: 'Test',
              mimeType: 'application/json',
              payTo: '0x1234',
              maxTimeoutSeconds: 60,
              asset: 'USDC',
            },
          },
        } as any,
        res as any,
      );

      // Should complete without crashing — result depends on verify logic
      expect(res._body).toBeDefined();
    });
  });

  describe('POST /settle', () => {
    it('returns 400 for missing parameters', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const settleRoute = findRoute(routes, 'post', '/settle')!;
      const res = createMockResponse();

      await settleRoute.handler({ body: {} } as any, res as any);

      expect(res._statusCode).toBe(400);
      expect((res._body as any).errorReason).toBe('missing_parameters');
    });

    it('returns 400 for invalid base64 payload', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const settleRoute = findRoute(routes, 'post', '/settle')!;
      const res = createMockResponse();

      await settleRoute.handler({ body: { paymentPayload: 'not-valid-base64!@#$', paymentRequirements: {} } } as any, res as any);

      expect(res._statusCode).toBe(400);
      expect((res._body as any).errorReason).toBe('invalid_payload_encoding');
    });
  });

  describe('GET /supported', () => {
    it('returns empty list with no config', async () => {
      const routes = createFacilitatorRoutes();
      const supportedRoute = findRoute(routes, 'get', '/supported')!;
      const res = createMockResponse();

      await supportedRoute.handler({} as any, res as any);

      expect((res._body as any).paymentKinds).toEqual([]);
    });

    it('includes EVM chains from config', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const supportedRoute = findRoute(routes, 'get', '/supported')!;
      const res = createMockResponse();

      await supportedRoute.handler({} as any, res as any);

      const kinds = (res._body as any).paymentKinds as Array<{ network: string; scheme: string }>;
      const evmKind = kinds.find((k) => k.network === 'arbitrum-sepolia');
      expect(evmKind).toBeDefined();
      expect(evmKind!.scheme).toBe('exact');
    });

    it('includes Fast networks from config', async () => {
      const routes = createFacilitatorRoutes(testFacilitatorConfig);
      const supportedRoute = findRoute(routes, 'get', '/supported')!;
      const res = createMockResponse();

      await supportedRoute.handler({} as any, res as any);

      const kinds = (res._body as any).paymentKinds as Array<{ network: string; scheme: string }>;
      const fastKind = kinds.find((k) => k.network === 'fast-testnet');
      expect(fastKind).toBeDefined();
      expect(fastKind!.scheme).toBe('exact');
    });

    it('returns both EVM and Fast kinds when configured', async () => {
      const config: FacilitatorConfig = {
        evmChains: {
          'base-sepolia': {
            chain: {} as any,
            rpcUrl: 'https://base-sepolia.example.com',
            usdcAddress: '0xABCD',
          },
          'arbitrum-sepolia': {
            chain: {} as any,
            rpcUrl: 'https://arb-sepolia.example.com',
            usdcAddress: '0x1234',
          },
        },
        fastNetworks: {
          'fast-testnet': {
            rpcUrl: 'https://testnet.api.fast.xyz/proxy',
            committeePublicKeys: [],
          },
          'fast-mainnet': {
            rpcUrl: 'https://api.fast.xyz/proxy',
            committeePublicKeys: [],
          },
        },
      };

      const routes = createFacilitatorRoutes(config);
      const supportedRoute = findRoute(routes, 'get', '/supported')!;
      const res = createMockResponse();
      await supportedRoute.handler({} as any, res as any);

      const kinds = (res._body as any).paymentKinds as Array<{ network: string }>;
      const networks = kinds.map((k) => k.network);
      expect(networks).toContain('base-sepolia');
      expect(networks).toContain('arbitrum-sepolia');
      expect(networks).toContain('fast-testnet');
      expect(networks).toContain('fast-mainnet');
      expect(kinds).toHaveLength(4);
    });
  });
});

describe('createFacilitatorServer', () => {
  it('routes requests to handlers', async () => {
    const middleware = createFacilitatorServer(testFacilitatorConfig);
    const res = createMockResponse();
    const next = createMockNext();

    await middleware({ method: 'GET', path: '/supported' } as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect((res._body as any).paymentKinds).toBeDefined();
  });

  it('calls next() for unknown routes', async () => {
    const middleware = createFacilitatorServer(testFacilitatorConfig);
    const res = createMockResponse();
    const next = createMockNext();

    await middleware({ method: 'GET', path: '/unknown' } as any, res as any, next);

    expect(next).toHaveBeenCalled();
  });

  it('matches routes case-insensitively on method', async () => {
    const middleware = createFacilitatorServer(testFacilitatorConfig);
    const res = createMockResponse();
    const next = createMockNext();

    await middleware({ method: 'get', path: '/supported' } as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect((res._body as any).paymentKinds).toBeDefined();
  });
});
