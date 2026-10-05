import { Duration, Effect, Exit, Fiber, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { ExplorerNotConfiguredError, ExplorerUnavailableError, InvalidUsageError, PaymentTimeoutError } from '../../src/errors/index.js';
import {
  findIncomingPayment,
  MAX_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_SECONDS,
  matchesIncomingPayment,
  POLL_IN_FLIGHT,
  validateWaitTimeoutSeconds,
  waitForIncoming,
} from '../../src/services/incoming-payments.js';
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

describe('sub-millisecond ordering', () => {
  // Explorer timestamps have microseconds; these instants share one millisecond.
  const SINCE_US = '2026-10-02T03:00:00.000900Z';
  const sinceNs = BigInt(Date.UTC(2026, 9, 2, 3)) * 1_000_000n + 900_000n;
  const exact = { ...criteria, since: new Date(Date.UTC(2026, 9, 2, 3)), sinceNs };

  it('does not accept a payment earlier within the same millisecond as `since`', () => {
    expect(matchesIncomingPayment(payment(1, '2026-10-02T03:00:00.000500Z'), exact)).toBe(false);
    expect(matchesIncomingPayment(payment(1, SINCE_US), exact)).toBe(true);
    expect(matchesIncomingPayment(payment(1, '2026-10-02T03:00:00.000901Z'), exact)).toBe(true);
  });

  it('returns the earliest payment even when two match within the same millisecond', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([payment(2, '2026-10-02T03:00:05.000700Z'), payment(1, '2026-10-02T03:00:05.000300Z')])));

    const found = await Effect.runPromise(findIncomingPayment(criteria).pipe(Effect.provide(explorer.layer)));

    expect(found?.hash).toBe(hashOf(1));
  });
});

describe('findIncomingPayment paging', () => {
  it('keeps paging past many newer rows until it reaches `since` (no page cap)', async () => {
    // 11 pages of unrelated newer rows, then the payment on page 12.
    const explorer = mockExplorer((params, call) => {
      if (call < 11) {
        const at = new Date(Date.parse('2026-10-02T04:00:00Z') - call * 60_000).toISOString();
        return Effect.succeed(page([payment(100 + call, at, { amount: '1' })], { hasMore: true, nextCursor: `c${call + 1}` }));
      }
      expect(params.cursor).toBe('c11');
      return Effect.succeed(page([payment(1, '2026-10-02T03:00:01Z')]));
    });

    const found = await Effect.runPromise(findIncomingPayment(criteria).pipe(Effect.provide(explorer.layer)));

    expect(found?.hash).toBe(hashOf(1));
    expect(explorer.calls).toHaveLength(12);
  });
});

describe('waitForIncoming', () => {
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.exit(effect).pipe(Effect.provide(TestContext.TestContext)));

  it('after a complete scan, later polls only read rows newer than what it saw (minus the overlap)', async () => {
    const noise = (n: number, at: string) => payment(n, at, { amount: '1' });
    const explorer = mockExplorer((params, call) => {
      if (params.cursor === null) {
        const fresh = call >= 4 ? [payment(1, '2026-10-02T03:31:00Z')] : [];
        return Effect.succeed(
          page([...fresh, noise(30, '2026-10-02T03:30:00Z'), noise(24, '2026-10-02T03:24:00Z')], { hasMore: true, nextCursor: 'c1' }),
        );
      }
      if (params.cursor === 'c1') return Effect.succeed(page([noise(10, '2026-10-02T03:10:00Z')], { hasMore: true, nextCursor: 'c2' }));
      return Effect.succeed(page([noise(2, '2026-10-02T02:59:00Z')], { hasMore: true, nextCursor: 'c3' }));
    });

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.millis(1));
        // First poll walks back to `since`: three pages.
        expect(explorer.calls.map((c) => c.cursor)).toEqual([null, 'c1', 'c2']);
        yield* TestClock.adjust(Duration.seconds(2));
        // Second poll: the first page already reaches 03:25 (newest seen 03:30 minus 5 min).
        expect(explorer.calls.map((c) => c.cursor)).toEqual([null, 'c1', 'c2', null]);
        yield* TestClock.adjust(Duration.seconds(2));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
    // Third poll: the incremental read (1 page) finds it, then the full window is re-read to confirm.
    expect(explorer.calls.map((c) => c.cursor)).toEqual([null, 'c1', 'c2', null, null, null, 'c1', 'c2']);
  });

  // Feed with newer unrelated rows on page 1 and older ones on pages 2-3. A
  // payment at 03:05 shows up on page 2 only after the first poll, as if the
  // indexer published it late (older than the incremental floor of 03:25).
  const lateIndexedFeed = () => {
    const noise = (n: number, at: string) => payment(n, at, { amount: '1' });
    let firstPollDone = false;
    return mockExplorer((params) => {
      if (params.cursor === null) {
        return Effect.succeed(page([noise(30, '2026-10-02T03:30:00Z'), noise(24, '2026-10-02T03:24:00Z')], { hasMore: true, nextCursor: 'c1' }));
      }
      if (params.cursor === 'c1') {
        const late = firstPollDone ? [payment(1, '2026-10-02T03:05:00Z')] : [];
        return Effect.succeed(page([noise(10, '2026-10-02T03:10:00Z'), ...late], { hasMore: true, nextCursor: 'c2' }));
      }
      firstPollDone = true;
      return Effect.succeed(page([noise(2, '2026-10-02T02:59:00Z')], { hasMore: true, nextCursor: 'c3' }));
    });
  };

  it('finds a payment the indexer published late, below the incremental floor, on the periodic full rescan', async () => {
    const explorer = lateIndexedFeed();

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 300_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(29));
        // Incremental polls stop on the first page, so the late row is not seen yet.
        expect(explorer.calls.filter((c) => c.cursor === 'c1')).toHaveLength(1);
        yield* TestClock.adjust(Duration.seconds(1));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
    expect(explorer.calls.filter((c) => c.cursor === 'c1')).toHaveLength(2);
  });

  it('reads back to `since` on every poll in the last 30 s before the timeout', async () => {
    const explorer = lateIndexedFeed();

    const exit = await run(
      Effect.gen(function* () {
        // A 20 s wait is entirely inside the final stretch: the second poll is already a full read.
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 20_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(2));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
    expect(explorer.calls.map((c) => c.cursor)).toEqual([null, 'c1', 'c2', null, 'c1', 'c2']);
  });

  it('returns the earliest match in the whole window when an incremental poll finds a newer one', async () => {
    const noise = (n: number, at: string) => payment(n, at, { amount: '1' });
    let firstPollDone = false;
    const explorer = mockExplorer((params) => {
      if (params.cursor === null) {
        // After the first poll a new matching payment arrives at the top...
        const fresh = firstPollDone ? [payment(2, '2026-10-02T03:31:00Z')] : [];
        return Effect.succeed(
          page([...fresh, noise(30, '2026-10-02T03:30:00Z'), noise(24, '2026-10-02T03:24:00Z')], { hasMore: true, nextCursor: 'c1' }),
        );
      }
      if (params.cursor === 'c1') {
        // ...and an earlier one shows up late, below the incremental floor (03:25).
        const late = firstPollDone ? [payment(1, '2026-10-02T03:05:00Z')] : [];
        return Effect.succeed(page([noise(10, '2026-10-02T03:10:00Z'), ...late], { hasMore: true, nextCursor: 'c2' }));
      }
      firstPollDone = true;
      return Effect.succeed(page([noise(3, '2026-10-02T02:59:00Z')], { hasMore: true, nextCursor: 'c3' }));
    });

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 300_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(2));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
  });

  it('rescans from `since` after a failed poll instead of skipping rows', async () => {
    const explorer = mockExplorer((params, call) => {
      if (call === 1) return Effect.fail(new ExplorerUnavailableError({ reason: 'HTTP 502' }));
      if (params.cursor === null)
        return Effect.succeed(page([payment(9, '2026-10-02T03:20:00Z', { amount: '1' })], { hasMore: true, nextCursor: 'c1' }));
      return Effect.succeed(page(call >= 3 ? [payment(1, '2026-10-02T03:05:00Z')] : [], { hasMore: false }));
    });

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(5));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.hash).toBe(hashOf(1));
  });

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
    // The third poll finds it incrementally and confirms it with one full read.
    expect(explorer.calls).toHaveLength(4);
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
    expect(error.message).toBe('No matching payment was observed within 10s (expected 0.1 testUSDC to me).');
    // Polls at t = 0, 2, 4, 6, 8 (and possibly 10) seconds.
    expect(explorer.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('calls a timeout incomplete when a matching first page was seen but an older page never answered', async () => {
    const explorer = mockExplorer((params) =>
      params.cursor === null ? Effect.succeed(page([payment(1, '2026-10-02T03:05:00Z')], { hasMore: true, nextCursor: 'older' })) : Effect.never,
    );

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 5_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(5));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error('expected timeout');
    const error = exit.cause.error as PaymentTimeoutError;
    expect(error).toBeInstanceOf(PaymentTimeoutError);
    expect(error.message).toContain('Payment verification did not complete within 5s');
    expect(error.message).not.toContain('No matching payment was observed');
    expect(explorer.calls.map((call) => call.cursor)).toEqual([null, 'older']);
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
    expect(exit.cause.error.message).toContain('Payment verification did not complete within 5s');
    expect(exit.cause.error.message).toContain('the earliest matching payment could not be confirmed: request timed out after 10s');
    expect(exit.cause.error.message).toContain(`${100_000n} base units of token ${TESTUSDC_ID} to ${ME} since ${SINCE.toISOString()}`);
  });

  it('says the explorer had not answered when the deadline interrupts a request in flight', async () => {
    // The explorer never answers; the overall timeout (5 s) fires before the 10 s request timeout would.
    const explorer = mockExplorer(() => Effect.never);

    const exit = await run(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(waitForIncoming({ ...criteria, timeoutMs: 5_000 }).pipe(Effect.provide(explorer.layer)));
        yield* TestClock.adjust(Duration.seconds(5));
        return yield* Fiber.join(fiber);
      }),
    );

    if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(PaymentTimeoutError);
    expect(exit.cause.error.message).toContain(
      `The last explorer poll did not complete, so the earliest matching payment could not be confirmed: ${POLL_IN_FLIGHT}`,
    );
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
    expect(explorer.calls).toHaveLength(3);
  });

  it('fails immediately when the network has no explorer API', async () => {
    const explorer = mockExplorer(() => Effect.fail(new ExplorerNotConfiguredError({ network: 'devnet' })));

    const exit = await run(waitForIncoming({ ...criteria, timeoutMs: 60_000 }).pipe(Effect.provide(explorer.layer)));

    if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(ExplorerNotConfiguredError);
    expect(explorer.calls).toHaveLength(1);
  });

  it('dies instead of waiting forever when timeoutMs is longer than the runtime timers support', async () => {
    // Effect's Clock never fires a delay over 2^31 - 1 ms, so such a wait would never time out.
    for (const timeoutMs of [MAX_WAIT_TIMEOUT_MS + 1, 0, Number.NaN]) {
      const explorer = mockExplorer(() => Effect.succeed(page([])));

      const exit = await run(waitForIncoming({ ...criteria, timeoutMs }).pipe(Effect.provide(explorer.layer)));

      if (!Exit.isFailure(exit) || exit.cause._tag !== 'Die') throw new Error(`expected a defect for ${timeoutMs}`);
      expect(explorer.calls).toHaveLength(0);
    }
  });
});

describe('validateWaitTimeoutSeconds', () => {
  it('accepts whole seconds from 1 to the longest delay the runtime timers support', async () => {
    expect(MAX_WAIT_TIMEOUT_SECONDS).toBe(2_147_483);
    expect(MAX_WAIT_TIMEOUT_SECONDS * 1000).toBeLessThanOrEqual(MAX_WAIT_TIMEOUT_MS);
    for (const seconds of [1, 300, MAX_WAIT_TIMEOUT_SECONDS]) {
      expect(await Effect.runPromise(validateWaitTimeoutSeconds(seconds))).toBe(seconds);
    }
  });

  it('rejects a timeout the runtime would treat as infinite, and non-positive or fractional ones', async () => {
    // 2147484 s is the first whole second past 2^31 - 1 ms; 1e20 is what `--timeout 99999999999999999999` parses to.
    for (const seconds of [MAX_WAIT_TIMEOUT_SECONDS + 1, 1e20, 0, -1, 1.5, Number.NaN]) {
      const exit = await Effect.runPromise(Effect.exit(validateWaitTimeoutSeconds(seconds)));

      if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error(`expected ${seconds} to be rejected`);
      expect(exit.cause.error).toBeInstanceOf(InvalidUsageError);
      expect(exit.cause.error.message).toBe('--timeout must be a whole number of seconds from 1 to 2147483 (about 24 days).');
    }
  });
});
