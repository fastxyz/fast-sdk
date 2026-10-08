import { expect, it, vi, afterEach } from 'vitest';
import { handleEvmPayment } from '../src/evm.js';
import { handleFastPayment } from '../src/fast.js';
import { fromV2 } from '@fastxyz/x402-types';
import { mockEvmWallet, mockEvmChainConfig } from './helpers.js';
import { readPaymentReceipt, resolveEvmNetworkConfig } from '../src/protocol.js';
import { x402Pay } from '../src/index.js';
afterEach(() => vi.unstubAllGlobals());
it('preserves a valid legacy receipt hash on a custom network', () => {
  const response = new Response('{}', {
    headers: {
      'X-PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ txHash: '0xactual', network: 'custom-evm' })).toString('base64'),
    },
  });
  expect(readPaymentReceipt(response)).toEqual({ txHash: '0xactual', network: 'custom-evm' });
});
const offer = {
  scheme: 'exact',
  network: 'eip155:84532',
  amount: '100000',
  asset: mockEvmChainConfig['base-sepolia'].usdcAddress,
  payTo: mockEvmWallet.address,
  maxTimeoutSeconds: 60,
  extra: { name: 'USD Coin', version: '2', unknown: [1, '2'] },
};
const resource = { url: 'https://example.com/paid', custom: [1, 2] };
it('finds canonical equivalent caller config while retaining its legacy key', () => {
  const config = { ...mockEvmChainConfig['base-sepolia'], chainId: 11155111 };
  expect(resolveEvmNetworkConfig('ethereum-sepolia', { sepolia: config })).toEqual({ network: 'sepolia', config });
});
it('uses caller sepolia config for a native ethereum offer without rewriting accepted', async () => {
  const nativeOffer = { ...offer, network: 'eip155:11155111' };
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      if (!init?.body && ++calls === 1)
        return new Response('', {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 2, resource, accepts: [nativeOffer] })).toString('base64') },
        });
      const body = init?.body ? JSON.parse(init.body) : undefined;
      if (body?.method === 'eth_call') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' + '186a0'.padStart(64, '0') }));
      expect(JSON.parse(Buffer.from(init.headers['PAYMENT-SIGNATURE'], 'base64').toString()).accepted).toEqual(nativeOffer);
      return new Response('{}');
    }),
  );
  const result = await x402Pay({
    url: resource.url,
    wallet: mockEvmWallet,
    evmNetworks: { sepolia: { ...mockEvmChainConfig['base-sepolia'], chainId: 11155111 } },
  });
  expect(result.payment?.network).toBe('sepolia');
});
it.each([undefined, 'authorization', 'deferred'])('rejects unsupported Fast paymentFlow %s before submission', async (paymentFlow) => {
  const nativeOffer = { ...offer, network: 'fast:testnet', extra: { paymentFlow } };
  const req = fromV2(nativeOffer, resource);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    handleFastPayment(
      resource.url,
      'GET',
      {},
      undefined,
      { x402Version: 2, accepts: [req], originalV2: { x402Version: 2, accepts: [nativeOffer], resource } },
      req,
      { type: 'fast', privateKey: '', publicKey: '', address: '', rpcUrl: '' },
    ),
  ).rejects.toThrow('Unsupported Fast v2 payment flow');
  expect(fetch).not.toHaveBeenCalled();
});
it.each([undefined, '', 42, {}])('does not expose invalid receipt transaction %# as a hash', (transaction) => {
  const res = new Response('{}', {
    headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ transaction, network: 'fast:testnet' })).toString('base64') },
  });
  expect(readPaymentReceipt(res)?.txHash).toBeUndefined();
});
it('EVM echoes the exact original native offer and reads native receipts', async () => {
  const req = fromV2(offer, resource);
  const fetch = vi.fn(async (_url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (body?.method === 'eth_call') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' + '186a0'.padStart(64, '0') }));
    const headers = init.headers;
    expect(headers['X-PAYMENT']).toBeUndefined();
    const sent = JSON.parse(Buffer.from(headers['PAYMENT-SIGNATURE'], 'base64').toString());
    expect(sent.x402Version).toBe(2);
    expect(sent.accepted).toEqual(offer);
    expect(sent.resource).toEqual(resource);
    expect(sent.payload.authorization.value).toBe('100000');
    return new Response('{}', {
      headers: {
        'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, transaction: '0xreceipt', network: offer.network })).toString('base64'),
      },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const result = await handleEvmPayment(
    resource.url,
    'GET',
    {},
    undefined,
    { x402Version: 2, accepts: [req], originalV2: { x402Version: 2, accepts: [offer], resource } },
    req,
    mockEvmWallet,
    mockEvmChainConfig['base-sepolia'],
  );
  expect(result.payment?.txHash).toBe('0xreceipt');
});
it.each(['fast', 'evm'])('rejects missing native metadata before any %s money operations', async (kind) => {
  const req = { ...fromV2(offer, resource), originalV2Requirement: undefined };
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const required = { x402Version: 2, accepts: [req] };
  const promise =
    kind === 'evm'
      ? handleEvmPayment(resource.url, 'GET', {}, undefined, required, req, mockEvmWallet, mockEvmChainConfig['base-sepolia'])
      : handleFastPayment(resource.url, 'GET', {}, undefined, required, req, {
          type: 'fast',
          privateKey: '',
          publicKey: '',
          address: '',
          rpcUrl: '',
        });
  await expect(promise).rejects.toThrow('Missing original v2');
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['amount', 'payTo', 'asset', 'network', 'extra'])('rejects mutated %s metadata before RPC or bridging', async (field) => {
  const req = fromV2(offer, resource);
  if (field === 'amount') req.maxAmountRequired = '999';
  if (field === 'payTo') req.payTo = 'another';
  if (field === 'asset') req.asset = 'another';
  if (field === 'network') req.network = 'arbitrum';
  if (field === 'extra') req.extra!.nested = 'tampered';
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    handleEvmPayment(
      resource.url,
      'GET',
      {},
      undefined,
      { x402Version: 2, accepts: [req], originalV2: { x402Version: 2, accepts: [offer], resource } },
      req,
      mockEvmWallet,
      mockEvmChainConfig['base-sepolia'],
    ),
  ).rejects.toThrow('mismatch');
  expect(fetch).not.toHaveBeenCalled();
});
