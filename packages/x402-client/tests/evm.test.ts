/**
 * Tests for EVM payment handler
 */

import { describe, it, afterEach, expect } from 'vitest';
import { handleEvmPayment } from '../src/evm.js';
import { mockEvmWallet, mock402Response, mockEvmChainConfig, createMockFetch } from './helpers.js';

const originalFetch = globalThis.fetch;

describe('EVM Payment Handler', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('handleEvmPayment', () => {
    it('should throw if no EVM chain config provided', async () => {
      const paymentRequired = mock402Response('arbitrum-sepolia');

      await expect(
        handleEvmPayment(
          'https://api.example.com/data',
          'GET',
          {},
          undefined,
          paymentRequired,
          paymentRequired.accepts![0],
          mockEvmWallet,
          // Missing chain config — pass undefined to simulate
          undefined as any,
          false,
          [],
        ),
      ).rejects.toThrow();
    });

    it('should throw if no USDC asset in requirements', async () => {
      const paymentRequired = mock402Response('arbitrum-sepolia');
      paymentRequired.accepts![0].asset = undefined;

      globalThis.fetch = createMockFetch([{ match: /testnet\.api\.fast\.xyz/, status: 200, body: { result: { balances: [] } } }]);

      await expect(
        handleEvmPayment(
          'https://api.example.com/data',
          'GET',
          {},
          undefined,
          paymentRequired,
          paymentRequired.accepts![0],
          mockEvmWallet,
          mockEvmChainConfig['arbitrum-sepolia'],
          false,
          [],
        ),
      ).rejects.toThrow();
    });

    it('should sign EIP-3009 authorization and send payment', async () => {
      const paymentRequired = mock402Response('arbitrum-sepolia', '100000');
      let paymentHeaderSent = false;
      let paymentPayload: unknown;

      globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : null;

        if (body?.method === 'eth_call') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: '0x00000000000000000000000000000000000000000000000000000000000186a0',
            }),
            { status: 200 },
          );
        }

        if (init?.headers && (init.headers as Record<string, string>)['X-PAYMENT']) {
          paymentHeaderSent = true;
          const header = (init.headers as Record<string, string>)['X-PAYMENT'];
          paymentPayload = JSON.parse(Buffer.from(header, 'base64').toString());
          return new Response(
            JSON.stringify({
              success: true,
              data: 'premium content',
              txHash: '0xabc123',
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({}), { status: 200 });
      };

      const result = await handleEvmPayment(
        'https://api.example.com/data',
        'GET',
        {},
        undefined,
        paymentRequired,
        paymentRequired.accepts![0],
        mockEvmWallet,
        mockEvmChainConfig['arbitrum-sepolia'],
        false,
        [],
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(paymentHeaderSent).toBe(true);

      expect(paymentPayload).toBeTruthy();
      const pp = paymentPayload as Record<string, unknown>;
      expect(pp.x402Version).toBe(1);
      expect(pp.scheme).toBe('exact');
      expect(pp.network).toBe('arbitrum-sepolia');

      const payload = pp.payload as Record<string, unknown>;
      expect(payload.signature).toBeTruthy();
      expect(payload.authorization).toBeTruthy();

      const auth = payload.authorization as Record<string, string>;
      expect(auth.from.toLowerCase()).toBe(mockEvmWallet.address.toLowerCase());
      expect(auth.to.toLowerCase()).toBe('0x1131623344cFdb04D06a9eD511BEc56FF6Ae4372'.toLowerCase());
      expect(auth.value).toBe('100000');
    });

    it('should include payment details in result', async () => {
      const paymentRequired = mock402Response('arbitrum-sepolia', '500000');

      globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : null;

        if (body?.method === 'eth_call') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: '0x000000000000000000000000000000000000000000000000000000000007a120',
            }),
            { status: 200 },
          );
        }

        if (init?.headers && (init.headers as Record<string, string>)['X-PAYMENT']) {
          return new Response(
            JSON.stringify({
              success: true,
              txHash: '0xdef456789',
            }),
            { status: 200 },
          );
        }

        return new Response('{}', { status: 200 });
      };

      const result = await handleEvmPayment(
        'https://api.example.com/data',
        'GET',
        {},
        undefined,
        paymentRequired,
        paymentRequired.accepts![0],
        mockEvmWallet,
        mockEvmChainConfig['arbitrum-sepolia'],
        false,
        [],
      );

      expect(result.payment).toBeTruthy();
      expect(result.payment!.network).toBe('arbitrum-sepolia');
      expect(result.payment!.amount).toBe('0.5');
      expect(result.payment!.recipient).toBe('0x1131623344cFdb04D06a9eD511BEc56FF6Ae4372');
      expect(result.payment!.txHash).toBeTruthy();
    });

    it('should handle verbose logging', async () => {
      const paymentRequired = mock402Response('arbitrum-sepolia', '100000');
      const logs: string[] = [];

      globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : null;

        if (body?.method === 'eth_call') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: '0x00000000000000000000000000000000000000000000000000000000000186a0',
            }),
            { status: 200 },
          );
        }

        if (init?.headers && (init.headers as Record<string, string>)['X-PAYMENT']) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        return new Response('{}', { status: 200 });
      };

      await handleEvmPayment(
        'https://api.example.com/data',
        'GET',
        {},
        undefined,
        paymentRequired,
        paymentRequired.accepts![0],
        mockEvmWallet,
        mockEvmChainConfig['arbitrum-sepolia'],
        true,
        logs,
      );

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.includes('EVM Payment Handler START'))).toBe(true);
      expect(logs.some((l) => l.includes('EIP-3009'))).toBe(true);
    });
  });
});
