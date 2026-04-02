/**
 * Tests for Fast payment handler
 *
 * The new implementation uses Signer + TransactionBuilder + FastProvider
 * instead of the old FastWallet class.
 */

import { afterEach, describe, it, vi, expect } from 'vitest';
import { FAST_NETWORKS } from '../../src/client/fast.js';

describe('Fast Payment Handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FAST_NETWORKS', () => {
    it('should include expected networks', () => {
      expect(Array.isArray(FAST_NETWORKS)).toBe(true);
      expect(FAST_NETWORKS).toContain('fast-testnet');
      expect(FAST_NETWORKS).toContain('fast-mainnet');
    });

    it('should only expose explicit Fast networks', () => {
      expect(FAST_NETWORKS).toEqual(['fast-testnet', 'fast-mainnet']);
    });
  });
});
