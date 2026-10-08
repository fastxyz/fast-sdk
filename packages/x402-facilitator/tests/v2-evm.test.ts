import { afterEach, expect, it, vi } from 'vitest';
import { toV2, encodePayload } from '@fastxyz/x402-types';
import { verify } from '../src/verify.js';
import { settle } from '../src/settle.js';
import { createFacilitatorRoutes } from '../src/server.js';
const mocks = vi.hoisted(() => ({
  verifyTypedData: vi.fn().mockResolvedValue(true),
  readContract: vi.fn(),
  writeContract: vi.fn().mockResolvedValue('0xtx'),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
}));
vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => mocks,
  createWalletClient: () => mocks,
}));
afterEach(() => vi.clearAllMocks());
it('native and legacy valid EVM verify/settle preserve configured sepolia alias and large authorization values', async () => {
  const amount = '90071992547409930000';
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === 'authorizationState' ? false : BigInt(amount),
  );
  const expected = {
    scheme: 'exact',
    network: 'sepolia',
    maxAmountRequired: amount,
    asset: `0x${'22'.repeat(20)}`,
    payTo: `0x${'33'.repeat(20)}`,
    maxTimeoutSeconds: 60,
    resource: '/data',
    description: '',
    mimeType: 'application/json',
    extra: { name: 'USD Coin', version: '2', serial: amount },
  };
  const authorization = {
    from: `0x${'44'.repeat(20)}`,
    to: expected.payTo,
    value: amount,
    validAfter: '0',
    validBefore: amount,
    nonce: `0x${'55'.repeat(32)}`,
  };
  const legacy = { x402Version: 1, scheme: 'exact', network: 'sepolia', payload: { authorization, signature: `0x${'11'.repeat(64)}1b` } };
  const native = { x402Version: 2 as const, accepted: toV2(expected), payload: legacy.payload };
  const config = {
    debug: false,
    evmPrivateKey: `0x${'11'.repeat(32)}` as `0x${string}`,
    evmChains: { sepolia: { chain: { id: 11155111 } as any, usdcAddress: expected.asset as `0x${string}` } },
  };
  const v1 = await verify(legacy, expected, config);
  const v2 = await verify(native, toV2(expected), config);
  expect(v1.isValid).toBe(true);
  expect(v2).toEqual({ ...v1, network: 'eip155:11155111' });
  const s1 = await settle(legacy, expected, config);
  const s2 = await settle(native, toV2(expected), config);
  expect(s1.success).toBe(true);
  expect(s2).toEqual({ ...s1, network: 'eip155:11155111' });
  expect(mocks.writeContract).toHaveBeenCalledTimes(2);
  expect(mocks.writeContract.mock.calls[1][0].args[2]).toBe(BigInt(amount));
  const routes = createFacilitatorRoutes(config);
  for (const path of ['/verify', '/settle']) {
    let body: any;
    let code = 200;
    const res = {
      status(value: number) {
        code = value;
        return this;
      },
      json(value: unknown) {
        body = value;
      },
    };
    await routes
      .find((route) => route.path === path)!
      .handler({ body: { paymentPayload: encodePayload(native), paymentRequirements: toV2(expected) } } as any, res as any);
    expect(code).toBe(200);
    expect(body.network).toBe('eip155:11155111');
    expect(path === '/verify' ? body.isValid : body.success).toBe(true);
  }
  expect(authorization.value).toBe(amount);
});
