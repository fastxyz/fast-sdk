import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastIdResolutionError, InvalidAddressError } from '../../src/errors/index.js';
import { FastIdResolver, FastIdResolverLive } from '../../src/services/api/fast-id.js';

const ALICE = 'fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const document = (overrides: Record<string, unknown> = {}) => ({
  id: 'https://id.fast.xyz/alice.smith',
  network: 'fast:mainnet',
  address: ALICE,
  name: 'alice.smith',
  name_claim_tx: 'ab'.repeat(32),
  verified_properties: [],
  signed_content_status: 'available',
  signed_content: [],
  imported_works: [],
  note: '',
  ...overrides,
});

const resolve = (name: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const r = yield* FastIdResolver;
      return yield* r.resolve(name, 'fast:mainnet');
    }).pipe(Effect.provide(FastIdResolverLive)),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FastIdResolverLive', () => {
  it('returns the bound address from the mainnet registry, with a request timeout', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => json(document()));
    vi.stubGlobal('fetch', fetchMock);

    const exit = await resolve('alice.smith');

    expect(exit._tag).toBe('Success');
    if (exit._tag === 'Success') expect(exit.value).toEqual({ name: 'alice.smith', address: ALICE });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://id.fast.xyz/alice.smith/id.json');
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps an unregistered name (404) to INVALID_ADDRESS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'not found' }, 404)),
    );

    const exit = await resolve('nobody.here');

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(InvalidAddressError);
    expect(exit.cause.error.message).toContain('not registered on fast:mainnet');
  });

  it('fails closed when the registry answers for another name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(document({ id: 'https://id.fast.xyz/mallory.x', name: 'mallory.x' }))),
    );

    const exit = await resolve('alice.smith');

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(FastIdResolutionError);
  });

  it('reports network errors as FAST_ID_RESOLUTION_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const exit = await resolve('alice.smith');

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    const error = exit.cause.error as FastIdResolutionError;
    expect(error).toBeInstanceOf(FastIdResolutionError);
    expect(error.errorCode).toBe('FAST_ID_RESOLUTION_FAILED');
    expect(error.message).toContain('fetch failed');
  });
});
