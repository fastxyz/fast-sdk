/**
 * Test helpers and mocks
 */

import type { FastWallet, EvmWallet, PaymentRequired } from '../../src/client/types.js';

// ─── Mock Wallets ─────────────────────────────────────────────────────────────

export const mockEvmWallet: EvmWallet = {
  type: 'evm',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat account #0
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

export const mockFastWallet: FastWallet = {
  type: 'fast',
  // Valid Ed25519 key pair for testing
  privateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  publicKey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  // Valid bech32m address (same as bridge address for testing)
  address: 'fast1x0g58phuf0pf32e9uvp3mv6hak4z37ytpqyfzjzhfsehua9kmegqwzv0td',
};

// ─── Mock 402 Responses ───────────────────────────────────────────────────────

export function mock402Response(network: string, amount: string = '100000'): PaymentRequired {
  const isEvm = ['arbitrum-sepolia', 'base-sepolia', 'arbitrum', 'base'].includes(network);
  
  return {
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network,
      maxAmountRequired: amount,
      payTo: isEvm 
        ? '0x1131623344cFdb04D06a9eD511BEc56FF6Ae4372'
        // Valid bech32m Fast address
        : 'fast19cjwajufyuqv883ydlvrp8xrhxejuvfe40pxq5dsrv675zgh89sqg9txs8',
      asset: isEvm 
        ? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
        : 'b4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5',
      extra: isEvm ? { name: 'USD Coin', version: '2' } : undefined,
    }],
  };
}

// ─── Mock Fetch ───────────────────────────────────────────────────────────────

export interface MockFetchResponse {
  status: number;
  ok: boolean;
  headers: Map<string, string>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export function createMockFetch(responses: Array<{
  match?: string | RegExp;
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}>): typeof fetch {
  let callIndex = 0;
  
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    
    // Find matching response
    let response = responses[callIndex];
    for (const r of responses) {
      if (r.match) {
        const matches = typeof r.match === 'string' 
          ? url.includes(r.match)
          : r.match.test(url);
        if (matches) {
          response = r;
          break;
        }
      }
    }
    
    if (!response) {
      response = responses[callIndex] || responses[responses.length - 1];
    }
    
    callIndex++;

    const headers = new Headers(response.headers);
    
    return {
      status: response.status,
      statusText: response.status === 200 ? 'OK' : response.status === 402 ? 'Payment Required' : 'Error',
      ok: response.status >= 200 && response.status < 300,
      headers,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as Response;
  };
}

// ─── Assertions ───────────────────────────────────────────────────────────────

export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message || 'Expected value to be defined');
  }
}
