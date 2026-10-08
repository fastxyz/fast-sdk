import { expect, it, vi, afterEach } from 'vitest';
import { fromV2 } from '@fastxyz/x402-types';
const fixture = vi.hoisted(() => ({
  envelope: { transaction: { nonce: 9007199254740993123n, sender: new Uint8Array([1, 2]) }, signature: new Uint8Array([3]) },
  signatures: [new Uint8Array([4, 5])],
}));
vi.mock('@fastxyz/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fastxyz/sdk')>()),
  FastProvider: class {
    async getAccountInfo() {
      return { nextNonce: 1n };
    }
    async submitTransaction() {
      return { type: 'Success', value: fixture };
    }
  },
  Signer: class {
    async getPublicKey() {
      return new Uint8Array(32);
    }
  },
  TransactionBuilder: class {
    addTokenTransfer() {}
    async sign() {
      return {};
    }
  },
  toFastAddress: () => 'payer',
  hashHex: async () => 'local-hash',
}));
vi.mock('effect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('effect')>();
  return { ...actual, Schema: { ...actual.Schema, encodeSync: () => (value: unknown) => value } };
});
import { handleFastPayment } from '../src/fast.js';
afterEach(() => vi.unstubAllGlobals());
it.each([1, 2, 'empty-native-receipt'])('Fast answers version %s exactly and keeps certificate bigint strings and arrays', async (variant) => {
  const version = variant === 'empty-native-receipt' ? 2 : variant;
  const offer = {
    scheme: 'exact',
    network: 'fast:testnet',
    amount: '1000',
    asset: '0x' + '01'.repeat(32),
    payTo: '0x' + '02'.repeat(32),
    maxTimeoutSeconds: 60,
    extra: { paymentFlow: 'upfront', nested: ['preserved'] },
  };
  const resource = { url: '/paid' };
  const req = fromV2(offer, resource);
  const required =
    version === 2
      ? { x402Version: 2, accepts: [req], originalV2: { x402Version: 2 as const, accepts: [offer], resource } }
      : { x402Version: 1, accepts: [req] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const name = version === 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT';
      expect(init.headers[version === 2 ? 'X-PAYMENT' : 'PAYMENT-SIGNATURE']).toBeUndefined();
      const sent = JSON.parse(Buffer.from(init.headers[name], 'base64').toString());
      expect(sent.x402Version).toBe(version);
      if (version === 2) expect(sent.accepted).toEqual(offer);
      else expect(sent.network).toBe('fast-testnet');
      expect(sent.payload.transactionCertificate.envelope.transaction.nonce).toBe('9007199254740993123');
      expect(sent.payload.transactionCertificate.signatures).toEqual([[4, 5]]);
      return new Response('{}', {
        headers: {
          [version === 2 ? 'PAYMENT-RESPONSE' : 'X-PAYMENT-RESPONSE']: Buffer.from(
            JSON.stringify({ transaction: variant === 'empty-native-receipt' ? '' : 'receipt-hash', network: offer.network }),
          ).toString('base64'),
        },
      });
    }),
  );
  const result = await handleFastPayment('/paid', 'GET', {}, undefined, required, req, {
    type: 'fast',
    address: 'payer',
    privateKey: 'unused',
    publicKey: 'unused',
    rpcUrl: 'mock-fast',
  });
  expect(result.payment?.txHash).toBe(variant === 'empty-native-receipt' ? 'local-hash' : 'receipt-hash');
});
