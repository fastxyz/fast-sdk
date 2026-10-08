import { expect, it } from 'vitest';
import { toV2, encodePayload } from '@fastxyz/x402-types';
import { privateKeyToAccount } from 'viem/accounts';
import { verify } from '../src/verify.js';
import { settle } from '../src/settle.js';
import { createFacilitatorRoutes } from '../src/server.js';
const requirement = {
  scheme: 'exact',
  network: 'fast-testnet',
  maxAmountRequired: '100000',
  asset: 'token',
  payTo: 'seller',
  maxTimeoutSeconds: 60,
  resource: '/data',
  description: '',
  mimeType: 'application/json',
};
for (const network of ['fast-testnet', 'base-sepolia']) {
  it(`${network}: native and legacy receive the same verification and settlement verdict`, async () => {
    const expected = { ...requirement, network };
    const legacy = { x402Version: 1, scheme: 'exact', network, payload: {} };
    const native = { x402Version: 2 as const, accepted: toV2(expected), payload: {} };
    const v1 = await verify(legacy, expected, { debug: false });
    const v2 = await verify(native, toV2(expected), { debug: false });
    expect(v2.isValid).toBe(v1.isValid);
    expect(v2.invalidReason).toBe(v1.invalidReason);
    const s1 = await settle(legacy, expected, { debug: false });
    const s2 = await settle(native, toV2(expected), { debug: false });
    expect(s2.success).toBe(s1.success);
    expect(s2.errorReason).toBe(s1.errorReason);
  });
}
it('rejects mismatched accepted terms before legacy verification', async () => {
  const native = { x402Version: 2 as const, accepted: { ...toV2(requirement), payTo: 'attacker' }, payload: {} };
  expect((await verify(native, requirement, { debug: false })).invalidReason).toBe('accepted_payment_requirement_mismatch');
});
it('supported retains legacy kinds and adds mapped v2 kinds with actual EVM signers', async () => {
  const key = `0x${'11'.repeat(32)}` as `0x${string}`;
  const routes = createFacilitatorRoutes({
    debug: false,
    evmPrivateKey: key,
    evmChains: { sepolia: { chain: { id: 11155111 } as any, usdcAddress: '0x123' } },
    fastNetworks: { 'fast-testnet': { rpcUrl: 'http://mock', committeePublicKeys: [] } },
  });
  let body: any;
  await routes
    .find((r) => r.path === '/supported')!
    .handler(
      {} as any,
      {
        json: (value: unknown) => {
          body = value;
        },
      } as any,
    );
  expect(body.paymentKinds).toHaveLength(2);
  expect(body.kinds).toContainEqual(expect.objectContaining({ x402Version: 2, network: 'eip155:11155111' }));
  expect(body.extensions).toEqual([]);
  expect(body.signers).toEqual({ 'eip155:*': [privateKeyToAccount(key).address] });
});
it('HTTP native decoding preserves large decimal strings and trusted terms', async () => {
  const expected = { ...requirement, maxAmountRequired: '90071992547409930000' };
  const native = { x402Version: 2 as const, accepted: toV2(expected), payload: {} };
  let body: any;
  let code = 200;
  await createFacilitatorRoutes({ debug: false })
    .find((r) => r.path === '/verify')!
    .handler(
      { body: { paymentPayload: encodePayload(native), paymentRequirements: toV2(expected) } } as any,
      {
        status: (value: number) => {
          code = value;
          return {
            json: (value: unknown) => {
              body = value;
            },
          };
        },
        json: (value: unknown) => {
          body = value;
        },
      } as any,
    );
  expect(code).toBe(200);
  expect(body.invalidReason).toBe('invalid_payload');
  expect(body.network).toBe('fast:testnet');
});
