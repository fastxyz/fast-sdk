import { Duration, Effect, Exit, Fiber, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { ExplorerNotConfiguredError, ExplorerUnavailableError, PaymentTimeoutError } from '../../src/errors/index.js';
import { findIncomingPayment, matchesIncomingPayment, waitForIncoming } from '../../src/services/incoming-payments.js';
import {
  BRIDGE,
  hashOf,
  LEO,
  ME,
  mockExplorer,
  OTHER,
  page,
  rawTransfer,
  TESTUSDC_ID,
  transfersFor,
  UNKNOWN_TOKEN_ID,
} from '../fixtures/explorer.js';

const SINCE = new Date('2026-10-02T03:00:00Z');
const criteria = { address: ME, amountRaw: 100_000n, tokenId: TESTUSDC_ID, since: SINCE };

/** An incoming 0.1 testUSDC payment from Leo at `at` (ISO), with overrides. */
const payment = (n: number, at: string, overrides: Record<string, unknown> = {}) =>
  transfersFor(ME, [rawTransfer({ hash: hashOf(n), submission_timestamp: at, ...overrides })])[0]!;

describe('matchesIncomingPayment', () => {
  const at = '2026-10-02T03:00:05Z';

  it('matches an exact incoming TokenTransfer or Mint after `since`', () => {
    expect(matchesIncomingPayment(payment(1, at), criteria)).toBe(true);
    expect(matchesIncomingPayment(payment(2, at, { type: 'Mint', from: BRIDGE }), criteria)).toBe(true);
  });

  it('accepts a token id without 0x or in upper case', () => {
    expect(matchesIncomingPayment(payment(1, at), { ...criteria, tokenId: TESTUSDC_ID.slice(2).toUpperCase() })).toBe(true);
  });

  it('rejects other amounts, tokens, senders, directions and earlier payments', () => {
    expect(matchesIncomingPayment(payment(1, at, { amount: '186a1' }), criteria)).toBe(false);
    expect(matchesIncomingPayment(payment(1, at, { token_id: UNKNOWN_TOKEN_ID }), criteria)).toBe(false);
    expect(matchesIncomingPayment(payment(1, at), { ...criteria, from: OTHER })).toBe(false);
    expect(matchesIncomingPayment(payment(1, at), { ...criteria, from: LEO.toUpperCase() })).toBe(true);
    expect(matchesIncomingPayment(transfersFor(ME, [rawTransfer({ from: ME, to: LEO })])[0]!, criteria)).toBe(false);
    expect(matchesIncomingPayment(transfersFor(ME, [rawTransfer({ from: ME, to: ME, submission_timestamp: at })])[0]!, criteria)).toBe(false);
    expect(matchesIncomingPayment(payment(1, '2026-10-02T02:59:59.999Z'), criteria)).toBe(false);
    expect(matchesIncomingPayment(payment(1, '2026-10-02T03:00:00.000Z'), criteria)).toBe(true);
  });

  it('ignores Burn rows', () => {
    expect(matchesIncomingPayment(payment(1, at, { type: 'Burn' }), criteria)).toBe(false);
  });
});

describe('findIncomingPayment', () => {
  it('walks back through pages until it passes `since`, returning the earliest match', async () => {
    const explorer = mockExplorer((_params, call) =>
      Effect.succeed(
        call === 0
          ? page([payment(3, '2026-10-02T03:10:00Z'), payment(4, '2026-10-02T03:09:00Z', { amount: '1' })], {
              hasMore: true,
              nextCursor: 'c1',
            })
          : page([payment(2, '2026-10-02T03:05:00Z'), payment(1, '2026-10-02T02:00:00Z')], { hasMore: true, nextCursor: 'c2' }),
      ),
    );

    const found = await Effect.runPromise(findIncomingPayment(criteria).pipe(Effect.provide(explorer.layer)));

    expect(found?.hash).toBe(hashOf(2));
    expect(explorer.calls).toEqual([
      { address: ME, side: 'to', order: 'desc', limit: 50, cursor: null },
      { address: ME, side: 'to', order: 'desc', limit: 50, cursor: 'c1' },
    ]);
  });
});

describe('waitForIncoming', () => {
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.exit(effect).pipe(Effect.provide(TestContext.TestContext)));

  it('polls every 2 s until the payment arrives', async () => {
    const explorer = mockExplorer((_params, call) =>
      Effect.succeed(page(call < 2 ? [payment(9, '2026-10-02T03:00:01Z', { amount: '1' })] : [payment(1, '2026-10-02T03:00:07Z')])),
    );

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(1));
        expect(explorer.calls).toHaveLength(1);
        yield* TestClock.adjust(Duration.seconds(1));
        expect(explorer.calls).toHaveLength(2);
        yield* TestClock.adjust(Duration.seconds(2));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
    expect(explorer.calls).toHaveLength(3);
  });

  it('fails with PAYMENT_TIMEOUT when nothing matching arrives', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([payment(1, '2026-10-02T02:00:00Z')])));

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          waitForIncoming({ ...criteria, timeoutMs: 10_000, description: '0.1 testUSDC to me' }).pipe(Effect.provide(explorer.layer)),
        );
        yield* TestClock.adjust(Duration.seconds(10));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    const error = exit.cause.error as PaymentTimeoutError;
    expect(error).toBeInstanceOf(PaymentTimeoutError);
    expect(error.errorCode).toBe('PAYMENT_TIMEOUT');
    expect(error.message).toBe('No matching payment arrived within 10s (expected 0.1 testUSDC to me).');
    // Polls at t = 0, 2, 4, 6, 8 (and possibly 10) seconds.
    expect(explorer.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('retries transient explorer errors until a poll succeeds', async () => {
    const explorer = mockExplorer((_params, call) =>
      call < 2 ? Effect.fail(new ExplorerUnavailableError({ reason: 'HTTP 503' })) : Effect.succeed(page([payment(1, '2026-10-02T03:00:01Z')])),
    );

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(4));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
    expect(explorer.calls).toHaveLength(3);
  });

  it('says so in the timeout error when the explorer was failing', async () => {
    const explorer = mockExplorer(() => Effect.fail(new ExplorerUnavailableError({ reason: 'request timed out after 10s' })));

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 5_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(5));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(PaymentTimeoutError);
    expect(exit.cause.error.message).toContain('a payment may have arrived unseen: request timed out after 10s');
    expect(exit.cause.error.message).toContain(`${100_000n} base units of token ${TESTUSDC_ID} to ${ME} since ${SINCE.toISOString()}`);
  });

  it('only accepts payments at or after `since` and from the expected sender', async () => {
    const explorer = mockExplorer((_params, call) =>
      Effect.succeed(
        page(
          call === 0
            ? [payment(1, '2026-10-02T02:59:00Z'), payment(2, '2026-10-02T03:00:30Z', { from: OTHER })]
            : [payment(3, '2026-10-02T03:00:40Z'), payment(1, '2026-10-02T02:59:00Z')],
        ),
      ),
    );

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, from: LEO, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(2));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(3));
    expect(explorer.calls).toHaveLength(2);
  });

  it('fails immediately when the network has no explorer API', async () => {
    const explorer = mockExplorer(() => Effect.fail(new ExplorerNotConfiguredError({ network: 'devnet' })));

    const exit = await run(waitForIncoming({ ...criteria, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));

    if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(ExplorerNotConfiguredError);
    expect(explorer.calls).toHaveLength(1);
  });
});
