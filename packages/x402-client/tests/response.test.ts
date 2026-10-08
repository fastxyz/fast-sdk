import { describe, expect, it, vi, afterEach } from 'vitest';
import { parse402Response, x402Pay } from '../src/index.js';
import { mock402Response, mockEvmWallet } from './helpers.js';

const v2 = {
  x402Version: 2,
  resource: { url: 'https://example.com/paid', description: 'content' },
  accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: '1000', asset: '0xabc', payTo: '0xdef', maxTimeoutSeconds: 60 }],
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
const response = (header: string, body = 'not JSON') => new Response(body, { status: 402, headers: { 'pAyMeNt-ReQuIrEd': header } });

afterEach(() => vi.unstubAllGlobals());

describe('authoritative PAYMENT-REQUIRED response header', () => {
  it.each([3, 0, null, '1'])('rejects unsupported legacy declared version %s before execution', async (x402Version) => {
    const legacy = { ...mock402Response('arbitrum-sepolia'), x402Version };
    const res = new Response(JSON.stringify(legacy), { status: 402 });
    const fetch = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', fetch);
    await expect(x402Pay({ url: 'https://example.com/paid', wallet: mockEvmWallet })).rejects.toThrow('Unsupported x402 protocol version');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'not JSON', JSON.stringify(mock402Response('arbitrum-sepolia'))])(
    'decodes v2 without consuming compatibility body %s',
    async (body) => {
      const res = response(encode(v2), body);
      expect(await parse402Response(res)).toEqual(v2);
      expect(res.bodyUsed).toBe(false);
    },
  );

  it.each([
    ['', 'empty'],
    ['not-base64!', 'invalid base64'],
    ['e30', 'missing padding'],
    ['e30=!', 'junk suffix'],
    ['e3 0=', 'embedded whitespace'],
    ['Zh==', 'noncanonical pad bits'],
    [Buffer.from('not JSON').toString('base64'), 'invalid JSON'],
    [encode({ ...v2, resource: undefined }), 'missing resource'],
    [encode({ ...v2, accepts: [] }), 'empty offers'],
    [encode({ ...v2, accepts: [{ ...v2.accepts[0], network: 'legacy' }] }), 'invalid network'],
    [encode({ ...v2, x402Version: 3 }), 'unsupported version'],
    [encode(mock402Response('arbitrum-sepolia')), 'v1 header'],
    ['A'.repeat(65540), 'oversize'],
  ])('rejects invalid header case %# without fallback or body consumption', async (header) => {
    const res = response(header, JSON.stringify(mock402Response('arbitrum-sepolia')));
    await expect(parse402Response(res)).rejects.toThrow(/Invalid PAYMENT-REQUIRED header/);
    expect(res.bodyUsed).toBe(false);
  });

  it('retains legacy body parsing', async () => {
    const legacy = mock402Response('arbitrum-sepolia');
    expect(await parse402Response(new Response(JSON.stringify(legacy), { status: 402 }))).toEqual(legacy);
  });

  it('rejects non-402 before decoding', async () => {
    const res = new Response('OK', { headers: { 'PAYMENT-REQUIRED': encode(v2) } });
    await expect(parse402Response(res)).rejects.toThrow('Expected 402 response');
    expect(res.bodyUsed).toBe(false);
  });

  it('fails closed before v2 payment execution or retry', async () => {
    const res = response(encode(v2), JSON.stringify(mock402Response('arbitrum-sepolia')));
    const fetch = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', fetch);
    await expect(x402Pay({ url: 'https://example.com/paid', wallet: mockEvmWallet, verbose: true })).rejects.toThrow(
      'v2 payment execution not enabled',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.bodyUsed).toBe(false);
  });
});
