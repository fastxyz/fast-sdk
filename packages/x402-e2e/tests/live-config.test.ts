import { describe, expect, it } from 'vitest';
import { readLiveConfig, requireMatrixGate } from '../src/live-config.js';
import { testnet } from '@fastxyz/sdk/networks';

const valid = {
  X402_LIVE_MATRIX: '1',
  FAST_TEST_RPC_URL: testnet.url,
  BASE_SEPOLIA_RPC_URL: 'https://example.invalid',
  FAST_TEST_COMMITTEE_PUBLIC_KEYS: 'ab'.repeat(32),
  X402_CONTROLLED_RECIPIENTS: '1',
  X402_MAX_FACILITATOR_ETH_WEI: '10000',
  FAST_TEST_SIGNER_PRIVATE_KEY: '11'.repeat(32),
  FAST_TEST_RECIPIENT_PRIVATE_KEY: '22'.repeat(32),
  BASE_SEPOLIA_PAYER_PRIVATE_KEY: '33'.repeat(32),
  BASE_SEPOLIA_RECIPIENT_PRIVATE_KEY: '44'.repeat(32),
  BASE_SEPOLIA_FACILITATOR_PRIVATE_KEY: '55'.repeat(32),
};

describe('live payment safety (no network or credentials)', () => {
  it('does not enable payments merely because credentials exist', () => {
    expect(readLiveConfig({ FAST_TEST_SIGNER_PRIVATE_KEY: 'secret' })).toBeNull();
  });
  it('fails closed for explicit opt-in without complete configuration', () => {
    expect(() => readLiveConfig({ X402_LIVE_MATRIX: '1' })).toThrow(/required/);
  });
  it('does not treat a skipped matrix as a release gate pass', () => {
    expect(() => requireMatrixGate({}, 0)).toThrow(/X402_LIVE_MATRIX/);
    expect(() => requireMatrixGate({ X402_LIVE_MATRIX: '1' }, 7)).toThrow(/eight/);
    expect(() => requireMatrixGate({ X402_LIVE_MATRIX: '1' }, 8)).not.toThrow();
  });
  it('normalizes keys and pins the SDK testnet endpoint', () => {
    expect(readLiveConfig(valid)?.fastPayerKey).toBe(`0x${valid.FAST_TEST_SIGNER_PRIVATE_KEY}`);
    expect(() => readLiveConfig({ ...valid, FAST_TEST_RPC_URL: 'https://mainnet.invalid' })).toThrow(/pinned/);
  });
  it('rejects empty trusted committee and unconfirmed recipient ownership', () => {
    expect(() => readLiveConfig({ ...valid, FAST_TEST_COMMITTEE_PUBLIC_KEYS: ',' })).toThrow(/nonempty/);
    expect(() => readLiveConfig({ ...valid, X402_CONTROLLED_RECIPIENTS: '0' })).toThrow(/controlled/);
  });
  it('requires separate payer, recipient and limited facilitator wallets', () => {
    expect(() => readLiveConfig({ ...valid, FAST_TEST_RECIPIENT_PRIVATE_KEY: valid.FAST_TEST_SIGNER_PRIVATE_KEY })).toThrow(/distinct/);
    expect(() => readLiveConfig({ ...valid, BASE_SEPOLIA_FACILITATOR_PRIVATE_KEY: valid.BASE_SEPOLIA_PAYER_PRIVATE_KEY })).toThrow(/distinct/);
  });
});
