/**
 * Detect incoming payments from the explorer feed. Used by `fast wait-for-payment`
 * and meant to be shared with other commands that wait for a payment (e.g. a
 * payment request that blocks until it is paid).
 */
import { Duration, Effect, Ref } from 'effect';
import { type ExplorerNotConfiguredError, type ExplorerUnavailableError, PaymentTimeoutError } from '../errors/index.js';
import { ExplorerApi, type ExplorerTransfersPage, type NetworkTransfer } from './api/explorer.js';

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Page size for each poll of the recipient's `to=` feed (newest first). */
export const POLL_PAGE_SIZE = 50;
/** Upper bound on pages read per poll when walking back to `since`. */
export const MAX_PAGES_PER_POLL = 10;

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
}

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
  transfer.timestampMs >= criteria.since.getTime();

/**
 * One poll: read the address's incoming feed newest-first, walking back page by
 * page until rows predate `since`, and return the earliest matching payment.
 */
export const findIncomingPayment = (
  criteria: IncomingPaymentCriteria,
): Effect.Effect<NetworkTransfer | undefined, ExplorerUnavailableError | ExplorerNotConfiguredError, ExplorerApi> =>
  Effect.gen(function* () {
    const explorer = yield* ExplorerApi;
    const sinceMs = criteria.since.getTime();
    let cursor: string | null = null;
    let earliest: NetworkTransfer | undefined;
    for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
      const result: ExplorerTransfersPage = yield* explorer.listTransfers({
        address: criteria.address,
        side: 'to',
        order: 'desc',
        limit: POLL_PAGE_SIZE,
        cursor,
      });
      for (const transfer of result.transfers) {
        if (matchesIncomingPayment(transfer, criteria) && (earliest === undefined || transfer.timestampMs < earliest.timestampMs)) {
          earliest = transfer;
        }
      }
      const passedSince = result.oldestTimestampMs !== null && result.oldestTimestampMs < sinceMs;
      if (passedSince || !result.hasMore || result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return earliest;
  });

/**
 * Poll the explorer until a payment matching the criteria arrives, or fail with
 * PAYMENT_TIMEOUT after `timeoutMs`. Transient explorer errors are retried until
 * the deadline; a network without an explorer API fails immediately. Sleeping and
 * the deadline use Effect's Clock, so tests can drive this with TestClock.
 */
export const waitForIncoming = (
  options: WaitForIncomingOptions,
): Effect.Effect<NetworkTransfer, PaymentTimeoutError | ExplorerNotConfiguredError, ExplorerApi> =>
  Effect.gen(function* () {
    const lastError = yield* Ref.make<string | undefined>(undefined);
    const interval = Duration.millis(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

    const poll = findIncomingPayment(options).pipe(
      Effect.tap(() => Ref.set(lastError, undefined)),
      Effect.catchTag('ExplorerUnavailableError', (error) => Ref.set(lastError, error.reason).pipe(Effect.as(undefined))),
    );

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
