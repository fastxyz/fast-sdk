import { describe, expect, it } from 'vitest';
import { readLiveConfig, requireMatrixGate } from '../src/live-config.js';
import { mainnet, testnet } from '@fastxyz/sdk/networks';

const valid = {
  X402_LIVE_MATRIX: '1',
  X402_MAINNET_SPENDING: '1',
  FAST_MAINNET_RPC_URL: mainnet.url,
  BASE_RPC_URL: 'https://example.invalid',
  X402_CONTROLLED_RECIPIENTS: '1',
  X402_MAX_FACILITATOR_ETH_WEI: '10000',
  FAST_MAINNET_SIGNER_PRIVATE_KEY: '11'.repeat(32),
  FAST_MAINNET_RECIPIENT_PRIVATE_KEY: '22'.repeat(32),
  BASE_PAYER_PRIVATE_KEY: '33'.repeat(32),
  BASE_RECIPIENT_PRIVATE_KEY: '44'.repeat(32),
  BASE_FACILITATOR_PRIVATE_KEY: '44'.repeat(32),
};

describe('live payment safety (no network or credentials)', () => {
  it('does not enable payments merely because credentials exist', () => {
    expect(readLiveConfig({ ...valid, X402_LIVE_MATRIX: undefined })).toBeNull();
  });
  it('fails closed for explicit opt-in without complete configuration', () => {
    expect(() => readLiveConfig({ X402_LIVE_MATRIX: '1', X402_MAINNET_SPENDING: '1' })).toThrow(/required/);
  });
  it('requires explicit acknowledgement of mainnet spending even with complete credentials', () => {
    expect(() => readLiveConfig({ ...valid, X402_MAINNET_SPENDING: undefined })).toThrow(/X402_MAINNET_SPENDING/);
    expect(() => readLiveConfig({ ...valid, X402_MAINNET_SPENDING: '0' })).toThrow(/X402_MAINNET_SPENDING/);
  });
  it('does not treat a skipped matrix as a release gate pass', () => {
    expect(() => requireMatrixGate({}, 0)).toThrow(/X402_LIVE_MATRIX/);
    expect(() => requireMatrixGate({ X402_LIVE_MATRIX: '1' }, 7)).toThrow(/eight/);
    expect(() => requireMatrixGate({ X402_LIVE_MATRIX: '1' }, 8)).not.toThrow();
  });
  it('normalizes keys and pins the SDK mainnet endpoint', () => {
    expect(readLiveConfig(valid)?.fastPayerKey).toBe(`0x${valid.FAST_MAINNET_SIGNER_PRIVATE_KEY}`);
    expect(() => readLiveConfig({ ...valid, FAST_MAINNET_RPC_URL: testnet.url })).toThrow(/pinned/);
  });
  it('uses the pinned official RPC without requiring separately provisioned committee keys', () => {
    expect(readLiveConfig(valid)?.fastRpcUrl).toBe(mainnet.url);
    expect(readLiveConfig(valid)).not.toHaveProperty('committeePublicKeys');
  });
  it('rejects unconfirmed recipient ownership', () => {
    expect(() => readLiveConfig({ ...valid, X402_CONTROLLED_RECIPIENTS: '0' })).toThrow(/controlled/);
  });
  it('requires the payer to differ from recipient and limited facilitator wallets', () => {
    expect(() => readLiveConfig({ ...valid, FAST_MAINNET_RECIPIENT_PRIVATE_KEY: valid.FAST_MAINNET_SIGNER_PRIVATE_KEY })).toThrow(/distinct/);
    expect(() => readLiveConfig({ ...valid, BASE_FACILITATOR_PRIVATE_KEY: valid.BASE_PAYER_PRIVATE_KEY })).toThrow(/distinct/);
    expect(() => readLiveConfig({ ...valid, BASE_RECIPIENT_PRIVATE_KEY: valid.BASE_PAYER_PRIVATE_KEY })).toThrow(/distinct/);
  });
  it('allows the recipient to fund gas while keeping it distinct from the payer', () => {
    const config = readLiveConfig(valid)!;
    expect(config.evmFacilitatorKey).toBe(config.evmRecipientKey);
  });
  it('rejects insecure Base RPC URLs and an unbounded gas wallet', () => {
    expect(() => readLiveConfig({ ...valid, BASE_RPC_URL: 'http://example.invalid' })).toThrow(/HTTPS/);
    expect(() => readLiveConfig({ ...valid, X402_MAX_FACILITATOR_ETH_WEI: '0' })).toThrow(/positive/);
  });
});
