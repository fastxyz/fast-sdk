/**
 * Tests for AllSet bridge functionality
 */

import { describe, it, afterEach, expect } from 'vitest';
import { 
  getFastBalance,
  bridgeFastusdcToUsdc,
} from '../src/bridge.js';

const originalFetch = globalThis.fetch;

describe('AllSet Bridge', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getFastBalance', () => {
    it('should return 0n when RPC call fails', async () => {
      globalThis.fetch = async () => {
        throw new Error('network error');
      };

      const balance = await getFastBalance(
        { type: 'fast', address: 'fast1test', privateKey: '0x' + '01'.repeat(32), publicKey: '01'.repeat(32), rpcUrl: 'https://testnet.api.fast.xyz/proxy' },
        { rpcUrl: 'https://testnet.api.fast.xyz/proxy', tokenId: 'abc123' },
      );
      expect(balance).toBe(0n);
    });
  });

  describe('bridgeFastusdcToUsdc', () => {
    it('should return error when RPC call fails', async () => {
      globalThis.fetch = async () => {
        throw new Error('network error');
      };

      const result = await bridgeFastusdcToUsdc({
        fastWallet: { type: 'fast', address: 'fast1test', privateKey: '0x' + '01'.repeat(32), publicKey: '01'.repeat(32), rpcUrl: 'https://testnet.api.fast.xyz/proxy' },
        evmReceiverAddress: '0x' + 'ab'.repeat(20),
        amount: 1000000n,
        rpcUrl: 'https://testnet.api.fast.xyz/proxy',
        fastBridgeAddress: 'fast1bridge',
        relayerUrl: 'https://relayer.example.com',
        crossSignUrl: 'https://crosssign.example.com',
        tokenEvmAddress: '0x' + 'cc'.repeat(20),
        tokenFastTokenId: 'abc123',
        networkId: 'fast:testnet',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
