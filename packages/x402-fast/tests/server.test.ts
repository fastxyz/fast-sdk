import { describe, expect, it, vi } from 'vitest';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactFastScheme, FAST_DEFAULT_ASSETS, FAST_SUPPORTED_NETWORKS } from '../src/index.js';
import type { SchemeNetworkServer, PaymentRequirements } from '@x402/core/types';

const server: SchemeNetworkServer = new ExactFastScheme();
const token = '0x' + 'a'.repeat(64);
const requirement = (): PaymentRequirements => ({ scheme: 'exact', network: 'fast:testnet', asset: token, amount: '1', payTo: '0x' + 'b'.repeat(64), maxTimeoutSeconds: 60, extra: {} });

describe('exact Fast server', () => {
  it('advertises upfront offers through the real core resource server without network calls', async () => {
    const facilitator = new HTTPFacilitatorClient({ url: 'https://unused.invalid' });
    vi.spyOn(facilitator, 'getSupported').mockResolvedValue({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'fast:testnet' }], extensions: [], signers: {} });
    const core = new x402ResourceServer(facilitator).register('fast:testnet', new ExactFastScheme());
    await core.initialize();
    const config = { scheme: 'exact', network: 'fast:testnet' as const, price: '$0.10', payTo: requirement().payTo };
    const offers = await core.buildPaymentRequirements(config);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ amount: '100000', asset: FAST_DEFAULT_ASSETS['fast:testnet'].asset, extra: { paymentFlow: 'upfront' } });
    expect(offers[0].extra).not.toHaveProperty('assetTransferMethod');
    await expect(core.buildPaymentRequirements({ ...config, extra: { paymentFlow: 'authorization' } })).rejects.toThrow();
  });
  it('declares the upstream upfront-only interface', () => {
    expect(server.scheme).toBe('exact');
    expect(server.defaultAssetTransferMethod).toBe('default');
    expect(server.paymentFlows).toEqual({ default: { supported: ['upfront'], default: 'upfront' } });
    expect(FAST_SUPPORTED_NETWORKS).toEqual(['fast:mainnet', 'fast:testnet']);
  });
  it('converts decimal prices exactly using only the network default asset', async () => {
    expect(await server.parsePrice('$1.000001', 'fast:mainnet')).toEqual({ amount: '1000001', asset: FAST_DEFAULT_ASSETS['fast:mainnet'].asset });
    expect(await server.parsePrice(0.1, 'fast:testnet')).toEqual({ amount: '100000', asset: FAST_DEFAULT_ASSETS['fast:testnet'].asset });
    expect(await server.parsePrice('9007199254740.000001', 'fast:testnet')).toMatchObject({ amount: '9007199254740000001' });
  });
  it.each(['fast', 'fast-mainnet', 'fast:other', 'eip155:1'])('rejects unsupported network %s', async network => {
    await expect(server.parsePrice('1', network as never)).rejects.toThrow(/network/i);
  });
  it.each(['0', '-1', '1e2', ' 1 ', '1.0000001', 'NaN', '$', '01', '1 USDC'])('rejects invalid or imprecise money %s', async price => {
    await expect(server.parsePrice(price, 'fast:testnet')).rejects.toThrow();
  });
  it('rejects nonfinite and imprecise numeric prices', async () => {
    for (const price of [NaN, Infinity, 0.1 + 0.2, Number.MAX_SAFE_INTEGER + 1]) await expect(server.parsePrice(price, 'fast:testnet')).rejects.toThrow();
  });
  it('accepts explicit canonical token atomic amounts without assigning a dollar peg', async () => {
    expect(await server.parsePrice({ asset: token, amount: '123', extra: { note: 'custom' } }, 'fast:testnet')).toEqual({ asset: token, amount: '123', extra: { note: 'custom' } });
    expect(server.getAssetDecimals?.(token, 'fast:testnet')).toBeUndefined();
    expect(server.getAssetDecimals?.(FAST_DEFAULT_ASSETS['fast:testnet'].asset, 'fast:testnet')).toBe(6);
  });
  it.each(['0', '01', '-1', '1.0', '1e3', ' 1'])('rejects invalid atomic amounts %s', async amount => {
    await expect(server.parsePrice({ asset: token, amount }, 'fast:testnet')).rejects.toThrow();
  });
  it('rejects malformed asset identifiers', async () => {
    await expect(server.parsePrice({ asset: 'USDC', amount: '1' }, 'fast:testnet')).rejects.toThrow(/asset/i);
  });
  it('enforces the Fast u256 amount range', async () => {
    const max = (1n << 256n) - 1n;
    expect(await server.parsePrice({ asset: token, amount: max.toString() }, 'fast:testnet')).toMatchObject({ amount: max.toString() });
    await expect(server.parsePrice({ asset: token, amount: (max + 1n).toString() }, 'fast:testnet')).rejects.toThrow();
  });
  it('enhances without mutating requirements or importing facilitator metadata', async () => {
    const input = requirement();
    const result = await server.enhancePaymentRequirements(input, { x402Version: 2, scheme: 'exact', network: 'fast:testnet', extra: { injected: true } }, []);
    expect(result.extra).toEqual({ paymentFlow: 'upfront' });
    expect(input.extra).toEqual({});
  });
  it('rejects unsupported flow, ATM and mismatched capabilities', async () => {
    const supported = { x402Version: 2, scheme: 'exact', network: 'fast:testnet' as const };
    for (const extra of [{ paymentFlow: 'authorization' }, { assetTransferMethod: 'permit2' }]) await expect(server.enhancePaymentRequirements({ ...requirement(), extra }, supported, [])).rejects.toThrow();
    await expect(server.enhancePaymentRequirements(requirement(), { ...supported, network: 'fast:mainnet' }, [])).rejects.toThrow();
    await expect(server.enhancePaymentRequirements(requirement(), { ...supported, x402Version: 1 }, [])).rejects.toThrow();
  });
});
