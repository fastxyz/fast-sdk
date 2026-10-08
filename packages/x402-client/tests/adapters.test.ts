import { expect, it } from 'vitest';
import { fromV2, toV2, toCanonicalNetwork, toLegacyNetwork, getNetworkType, fromV2PaymentPayload } from '@fastxyz/x402-types';

it.each(['fast:testnet', 'eip155:84532'])('roundtrips native offers without losing extra metadata: %s', (network) => {
  const offer = {
    scheme: 'exact' as const,
    network,
    amount: '9007199254740993123',
    asset: 'token',
    payTo: 'recipient',
    maxTimeoutSeconds: 60,
    extra: { nested: [1, '2'] },
    future: { value: 'retained' },
  };
  const resource = { url: '/paid', description: 'resource', mimeType: 'application/json' };
  expect(toV2(fromV2(offer, resource))).toEqual(offer);
});
it('compares trusted legacy aliases canonically at the payload boundary', () => {
  const expected = {
    ...fromV2({ scheme: 'exact', network: 'eip155:11155111', amount: '1', asset: 'token', payTo: 'recipient', maxTimeoutSeconds: 60 }),
    network: 'sepolia',
  };
  expect(
    fromV2PaymentPayload({ x402Version: 2, accepted: toV2({ ...expected, originalV2Requirement: undefined }), payload: {} }, expected).network,
  ).toBe('sepolia');
});
it('uses explicit network mappings and classifies canonical Fast', () => {
  expect(getNetworkType('fast:testnet')).toBe('fast');
  expect(toCanonicalNetwork('base-sepolia')).toBe('eip155:84532');
  expect(toLegacyNetwork('fast:mainnet')).toBe('fast-mainnet');
  expect(() => toCanonicalNetwork('unknown')).toThrow();
  expect(() => toLegacyNetwork('eip155:123456')).toThrow();
  expect(() => toCanonicalNetwork('constructor')).toThrow();
  expect(() => toCanonicalNetwork('__proto__')).toThrow();
  expect(toCanonicalNetwork('ethereum-sepolia')).toBe('eip155:11155111');
});
