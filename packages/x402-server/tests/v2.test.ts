import { afterEach, expect, it, vi } from 'vitest';
import { encodePayload, decodePayload, toV2 } from '@fastxyz/x402-types';
import { createPaymentRequired, createPaymentRequirement } from '../src/payment.js';
import { paymentMiddleware } from '../src/middleware.js';

const route = { price: '$0.10', network: 'fast-testnet', networkConfig: { asset: 'token', decimals: 6 } };
function response() {
  return {
    code: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
it('advertises native upfront beside the identical legacy body', async () => {
  const res = response();
  await paymentMiddleware(
    'seller',
    { '/data': route },
    { url: 'http://mock' },
    { debug: false },
  )({ method: 'GET', path: '/data', header: () => undefined }, res, () => {});
  expect(res.body).toEqual(createPaymentRequired('seller', route, '/data'));
  const native = decodePayload<any>(res.headers['PAYMENT-REQUIRED']);
  expect(native.x402Version).toBe(2);
  expect(native.accepts[0].extra.paymentFlow).toBe('upfront');
});
it('keeps unmapped custom v1 routes without bogus native advertising', async () => {
  const res = response();
  await paymentMiddleware(
    'seller',
    { '/data': { ...route, network: 'custom-chain' } },
    { url: 'http://mock' },
    { debug: false },
  )({ method: 'GET', path: '/data', header: () => undefined }, res, () => {});
  expect(res.code).toBe(402);
  expect(res.headers['PAYMENT-REQUIRED']).toBeUndefined();
});
it('native upfront verifies only and emits both receipt formats', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true, network: 'fast-testnet', payer: 'payer' }) });
  vi.stubGlobal('fetch', fetch);
  const accepted = toV2(createPaymentRequirement('seller', route, '/data'));
  const header = encodePayload({ x402Version: 2, accepted, payload: {} });
  const res = response();
  const next = vi.fn();
  await paymentMiddleware(
    'seller',
    { '/data': route },
    { url: 'http://mock' },
    { debug: false },
  )({ method: 'GET', path: '/data', header: (name) => (name === 'PAYMENT-SIGNATURE' ? header : undefined) }, res, next);
  expect(next).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(decodePayload<any>(res.headers['X-PAYMENT-RESPONSE']).network).toBe('fast-testnet');
  expect(decodePayload<any>(res.headers['PAYMENT-RESPONSE']).network).toBe('fast:testnet');
});
it('invalid native cannot downgrade to a valid legacy header', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const res = response();
  const next = vi.fn();
  await paymentMiddleware(
    'seller',
    { '/data': route },
    { url: 'http://mock' },
    { debug: false },
  )(
    {
      method: 'GET',
      path: '/data',
      header: (name) =>
        name === 'PAYMENT-SIGNATURE' ? 'invalid' : encodePayload({ x402Version: 1, scheme: 'exact', network: 'fast-testnet', payload: {} }),
    },
    res,
    next,
  );
  expect(res.code).toBe(402);
  expect(next).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it('custom legacy EVM routes still settle without native mapping', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ isValid: true, network: 'custom-chain' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, network: 'custom-chain', txHash: 'tx' }) });
  vi.stubGlobal('fetch', fetch);
  const res = response();
  const next = vi.fn();
  await paymentMiddleware(
    'seller',
    { '/data': { ...route, network: 'custom-chain' } },
    { url: 'http://mock' },
    { debug: false },
  )(
    {
      method: 'GET',
      path: '/data',
      header: (name) => (name === 'X-PAYMENT' ? encodePayload({ x402Version: 1, scheme: 'exact', network: 'custom-chain', payload: {} }) : undefined),
    },
    res,
    next,
  );
  expect(next).toHaveBeenCalledOnce();
  expect(decodePayload<any>(res.headers['X-PAYMENT-RESPONSE']).network).toBe('custom-chain');
  expect(res.headers['PAYMENT-RESPONSE']).toBeUndefined();
});
for (const version of [1, 3]) {
  it(`PAYMENT-SIGNATURE v${version} cannot fall back to X-PAYMENT`, async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = response();
    const next = vi.fn();
    const legacy = encodePayload({ x402Version: version, scheme: 'exact', network: 'fast-testnet', payload: {} });
    await paymentMiddleware(
      'seller',
      { '/data': route },
      { url: 'http://mock' },
      { debug: false },
    )({ method: 'GET', path: '/data', header: () => legacy }, res, next);
    expect(res.code).toBe(402);
    expect(next).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
}
it('valid native EVM settles and preserves both receipt formats', async () => {
  const evmRoute = { ...route, network: 'base-sepolia' };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ isValid: true, network: 'base-sepolia', payer: 'payer' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, network: 'base-sepolia', payer: 'payer', txHash: 'tx' }) });
  vi.stubGlobal('fetch', fetch);
  const header = encodePayload({ x402Version: 2, accepted: toV2(createPaymentRequirement('seller', evmRoute, '/data')), payload: {} });
  const res = response();
  const next = vi.fn();
  await paymentMiddleware(
    'seller',
    { '/data': evmRoute },
    { url: 'http://mock' },
    { debug: false },
  )({ method: 'GET', path: '/data', header: (name) => (name === 'PAYMENT-SIGNATURE' ? header : undefined) }, res, next);
  expect(next).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(decodePayload<any>(res.headers['X-PAYMENT-RESPONSE'])).toEqual({ success: true, network: 'base-sepolia', payer: 'payer', txHash: 'tx' });
  expect(decodePayload<any>(res.headers['PAYMENT-RESPONSE'])).toEqual({
    success: true,
    network: 'eip155:84532',
    payer: 'payer',
    txHash: 'tx',
    transaction: 'tx',
  });
});
it('native accepted attacker terms fail before reaching the facilitator', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const header = encodePayload({
    x402Version: 2,
    accepted: { ...toV2(createPaymentRequirement('seller', route, '/data')), amount: '1' },
    payload: {},
  });
  const res = response();
  const next = vi.fn();
  await paymentMiddleware(
    'seller',
    { '/data': route },
    { url: 'http://mock' },
    { debug: false },
  )({ method: 'GET', path: '/data', header: (name) => (name === 'PAYMENT-SIGNATURE' ? header : undefined) }, res, next);
  expect(res.code).toBe(402);
  expect(fetch).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
