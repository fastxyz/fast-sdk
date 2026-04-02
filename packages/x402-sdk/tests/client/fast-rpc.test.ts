/**
 * Tests for Fast RPC endpoint resolution.
 */

import { describe, it, expect } from 'vitest';
import { FAST_RPC_URLS, resolveFastRpcUrl } from '../../src/client/fast-rpc.js';

describe('Fast RPC resolution', () => {
  it('resolves testnet and mainnet to the official Fast proxies', () => {
    expect(FAST_RPC_URLS['fast-testnet']).toBe('https://testnet.api.fast.xyz/proxy');
    expect(FAST_RPC_URLS['fast-mainnet']).toBe('https://api.fast.xyz/proxy');
  });

  it('uses the network-specific default when no override is provided', () => {
    expect(resolveFastRpcUrl('fast-testnet')).toBe('https://testnet.api.fast.xyz/proxy');
    expect(resolveFastRpcUrl('fast-mainnet')).toBe('https://api.fast.xyz/proxy');
  });

  it('falls back to testnet for unknown networks', () => {
    expect(resolveFastRpcUrl('unknown-fast-network')).toBe('https://testnet.api.fast.xyz/proxy');
  });

  it('prefers an explicit rpc override', () => {
    expect(resolveFastRpcUrl('fast-mainnet', 'https://custom.fast.example/proxy'))
      .toBe('https://custom.fast.example/proxy');
  });
});
