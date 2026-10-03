/**
 * Detect incoming payments from the explorer feed. Used by `fast wait-for-payment`
 * and meant to be shared with other commands that wait for a payment (e.g. a
 * payment request that blocks until it is paid).
 */
import { Clock, Duration, Effect, Ref } from 'effect';
import { type ExplorerNotConfiguredError, type ExplorerUnavailableError, PaymentTimeoutError } from '../errors/index.js';
import { ExplorerApi, type ExplorerTransfersPage, type NetworkTransfer } from './api/explorer.js';

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Page size for each poll of the recipient's `to=` feed (newest first). */
export const POLL_PAGE_SIZE = 50;
/**
 * After a complete scan, later polls only walk back to the newest row already
 * seen minus this margin, so rows the indexer publishes a little late (with an
 * older submission time) are still read.
 */
export const RESCAN_OVERLAP_MS = 5 * 60_000;
/**
 * At least this often, and on every poll in this last stretch before the
 * timeout, a poll reads all the way back to `since` again. That catches a row
 * the indexer publishes later than RESCAN_OVERLAP_MS with an older submission
 * time, which an incremental poll would skip.
 */
export const FULL_RESCAN_INTERVAL_MS = 30_000;

/** Reported when the wait times out while an explorer request is still in progress. */
export const POLL_IN_FLIGHT = 'the explorer had not answered yet when the time ran out';

export interface IncomingPaymentCriteria {
  /** fast1… address that must receive the payment. */
  readonly address: string;
  /** Exact amount in the token's base units. */
  readonly amountRaw: bigint;
  /** Fast token id (hex, with or without 0x; case-insensitive). */
  readonly tokenId: string;
  /** When set, only a payment sent by this fast1… address matches. */
  readonly from?: string;
  /** Only payments submitted at or after this instant match. */
  readonly since: Date;
  /**
   * The same instant in epoch nanoseconds, when it has sub-millisecond
   * precision (e.g. a `--since` with microseconds). Defaults to `since`.
   */
  readonly sinceNs?: bigint;
}

/** `since` in epoch nanoseconds, exact when `sinceNs` is given. */
export const sinceNsOf = (criteria: IncomingPaymentCriteria): bigint => criteria.sinceNs ?? BigInt(criteria.since.getTime()) * 1_000_000n;

export interface WaitForIncomingOptions extends IncomingPaymentCriteria {
  /** Give up after this long (milliseconds). */
  readonly timeoutMs: number;
  /** Delay between polls (default 2 s). */
  readonly pollIntervalMs?: number;
  /** How the expected payment is described in the timeout error (default: base units and token id). */
  readonly description?: string;
}

const sameHex = (a: string, b: string): boolean => a.replace(/^0x/i, '').toLowerCase() === b.replace(/^0x/i, '').toLowerCase();
const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * True when `transfer` is a payment that satisfies `criteria`: an incoming
 * `TokenTransfer` or `Mint` to the address from someone else, of exactly the
 * amount and token, from the expected sender (if any), at or after `since`.
 */
export const matchesIncomingPayment = (transfer: NetworkTransfer, criteria: IncomingPaymentCriteria): boolean =>
  (transfer.type === 'TokenTransfer' || transfer.type === 'Mint') &&
  sameAddress(transfer.to, criteria.address) &&
  !sameAddress(transfer.from, criteria.address) &&
  transfer.amount === criteria.amountRaw &&
  sameHex(transfer.tokenId, criteria.tokenId) &&
  (criteria.from === undefined || sameAddress(transfer.from, criteria.from)) &&
  // Exact comparison: two instants in the same millisecond are still ordered.
  transfer.timestampNs >= sinceNsOf(criteria);

interface IncomingScan {
  /** Earliest matching payment among the rows read, if any. */
  readonly match: NetworkTransfer | undefined;
  /** Newest submission time among the rows read (null when the feed was empty). */
  readonly newestMs: number | null;
}

/**
 * Read the address's incoming feed newest-first, page by page, until rows are
 * older than `floorMs` or the feed ends. There is no page cap: a busy address
 * may need many pages to reach the floor, and the caller's timeout bounds the
 * total work. Returns the earliest matching payment among the rows read.
 */
const scanIncoming = (
  criteria: IncomingPaymentCriteria,
  floorMs: number,
): Effect.Effect<IncomingScan, ExplorerUnavailableError | ExplorerNotConfiguredError, ExplorerApi> =>
  Effect.gen(function* () {
    const explorer = yield* ExplorerApi;
    let cursor: string | null = null;
    let earliest: NetworkTransfer | undefined;
    let newestMs: number | null = null;
    while (true) {
      const result: ExplorerTransfersPage = yield* explorer.listTransfers({
        address: criteria.address,
        side: 'to',
        order: 'desc',
        limit: POLL_PAGE_SIZE,
        cursor,
      });
      for (const transfer of result.transfers) {
        if (matchesIncomingPayment(transfer, criteria) && (earliest === undefined || transfer.timestampNs < earliest.timestampNs)) {
          earliest = transfer;
        }
      }
      if (newestMs === null) newestMs = result.newestTimestampMs;
      const passedFloor = result.oldestTimestampMs !== null && result.oldestTimestampMs < floorMs;
      if (passedFloor || !result.hasMore || result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return { match: earliest, newestMs };
  });

/**
 * One full poll: read the address's incoming feed back to `since` and return
 * the earliest matching payment.
 */
export const findIncomingPayment = (
  criteria: IncomingPaymentCriteria,
): Effect.Effect<NetworkTransfer | undefined, ExplorerUnavailableError | ExplorerNotConfiguredError, ExplorerApi> =>
  scanIncoming(criteria, criteria.since.getTime()).pipe(Effect.map((scan) => scan.match));

/**
 * Poll the explorer until a payment matching the criteria arrives, or fail with
 * PAYMENT_TIMEOUT after `timeoutMs`.
 *
 * The first poll reads everything back to `since`. After a complete poll, later
 * polls only read rows newer than what it saw (minus RESCAN_OVERLAP_MS), so a
 * payment buried under many newer rows is still found and polls stay cheap. A
 * full read back to `since` is repeated every FULL_RESCAN_INTERVAL_MS and on
 * every poll in the last FULL_RESCAN_INTERVAL_MS before the deadline, so a row
 * the indexer publishes late, with an older timestamp, is still found before
 * the command gives up. When an incremental poll finds a match, the whole
 * window back to `since` is read once more before it is returned, so the result
 * is always the earliest matching payment in the window.
 *
 * Transient explorer errors are retried until the deadline (a failed poll keeps
 * the previous floor); a network without an explorer API fails immediately.
 * Sleeping and the deadline use Effect's Clock, so tests can drive this with
 * TestClock.
 */
export const waitForIncoming = (
  options: WaitForIncomingOptions,
): Effect.Effect<NetworkTransfer, PaymentTimeoutError | ExplorerNotConfiguredError, ExplorerApi> =>
  Effect.gen(function* () {
    const lastError = yield* Ref.make<string | undefined>(undefined);
    const sinceMs = options.since.getTime();
    const deadlineMs = (yield* Clock.currentTimeMillis) + options.timeoutMs;
    // floorMs: rows older than this were already read by a completed poll.
    const progress = yield* Ref.make({ floorMs: sinceMs, lastFullScanMs: Number.NEGATIVE_INFINITY });
    const interval = Duration.millis(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

    const poll = Effect.gen(function* () {
      // Marked before the requests: if the deadline interrupts them mid-flight,
      // the timeout error says so instead of implying the explorer was read.
      yield* Ref.set(lastError, POLL_IN_FLIGHT);
      const now = yield* Clock.currentTimeMillis;
      const state = yield* Ref.get(progress);
      const full = now - state.lastFullScanMs >= FULL_RESCAN_INTERVAL_MS || deadlineMs - now <= FULL_RESCAN_INTERVAL_MS;
      const scan = yield* scanIncoming(options, full ? sinceMs : state.floorMs);
      // An incremental poll only sees rows above the floor. Before reporting a
      // match, read the whole window back to `since` so the earliest matching
      // payment wins, including one the indexer published late below the floor.
      const confirmed = !full && scan.match !== undefined ? yield* scanIncoming(options, sinceMs) : undefined;
      yield* Ref.set(lastError, undefined);
      yield* Ref.set(progress, {
        floorMs: scan.newestMs === null ? state.floorMs : Math.max(sinceMs, scan.newestMs - RESCAN_OVERLAP_MS),
        lastFullScanMs: full || confirmed !== undefined ? now : state.lastFullScanMs,
      });
      return confirmed?.match ?? scan.match;
    }).pipe(Effect.catchTag('ExplorerUnavailableError', (error) => Ref.set(lastError, error.reason).pipe(Effect.as(undefined))));

    const loop = Effect.gen(function* () {
      while (true) {
        const found = yield* poll;
        if (found !== undefined) return found;
        yield* Effect.sleep(interval);
      }
    });

    return yield* loop.pipe(
      Effect.timeout(Duration.millis(options.timeoutMs)),
      Effect.catchTag('TimeoutException', () =>
        Effect.flatMap(Ref.get(lastError), (last) =>
          Effect.fail(
            new PaymentTimeoutError({
              expected: options.description ?? describeCriteria(options),
              timeoutSeconds: Math.round(options.timeoutMs / 1000),
              lastError: last,
            }),
          ),
        ),
      ),
    );
  });

const describeCriteria = (c: IncomingPaymentCriteria): string =>
  `${c.amountRaw} base units of token ${c.tokenId} to ${c.address}${c.from ? ` from ${c.from}` : ''} since ${c.since.toISOString()}`;
