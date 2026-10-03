/**
 * Read-only client for the Fast explorer indexer API (`GET {explorerApiUrl}/explorer/transfers`),
 * the same feed app.fast.xyz uses for wallet activity. It sees every transfer
 * that touches an address, including payments received from other accounts and
 * EVM → Fast deposits (which appear as `Mint` rows from the bridge account), so
 * it complements the local history store, which only knows what this CLI sent.
 */
import { bech32m } from 'bech32';
import { Context, Effect, Layer } from 'effect';
import { ExplorerNotConfiguredError, ExplorerUnavailableError } from '../../errors/index.js';
import type { NetworkConfig } from '../../schemas/networks.js';
import { ClientConfig } from '../config/client.js';
import { NetworkConfigService } from '../storage/network.js';
import { lookupFastTokenById } from '../token-resolver.js';

export const EXPLORER_REQUEST_TIMEOUT_MS = 10_000;
export const EXPLORER_MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/** Explorer row types that move a token amount. Other types (e.g. `ExternalClaim`) are skipped. */
export const VALUE_TRANSFER_TYPES = ['TokenTransfer', 'Mint', 'Burn'] as const;
export type ValueTransferType = (typeof VALUE_TRANSFER_TYPES)[number];

export type TransferDirection = 'in' | 'out' | 'self';

/** The CLI history `type` (as in `fast info history`) for an explorer value-transfer type. */
export const historyTypeOf = (type: ValueTransferType): 'transfer' | 'token-mint' | 'token-burn' =>
  type === 'Mint' ? 'token-mint' : type === 'Burn' ? 'token-burn' : 'transfer';

/** One explorer row after shape validation; nothing is interpreted yet. */
export interface ExplorerTransferRow {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly type: string;
  /** 0x-prefixed lowercase token id, or null when absent/malformed. */
  readonly tokenId: string | null;
  /** Amount in base units, or null when absent/malformed. The API sends unprefixed hex. */
  readonly amount: bigint | null;
  readonly opIndex: number;
  readonly timestampMs: number;
  /** Exact submission time in epoch nanoseconds (the explorer reports microseconds). */
  readonly timestampNs: bigint;
}

export interface ExplorerRowsPage {
  readonly rows: readonly ExplorerTransferRow[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** A value-moving transfer normalized relative to the queried address. */
export interface NetworkTransfer {
  /** 0x-prefixed lowercase transaction hash. */
  readonly hash: string;
  readonly opIndex: number;
  readonly type: ValueTransferType;
  readonly from: string;
  readonly to: string;
  /** Relative to the queried address: `in` (to it), `out` (from it), `self` (both). */
  readonly direction: TransferDirection;
  /** The other side of the transfer (the address itself for `self`). */
  readonly counterparty: string;
  /** Amount in base units. */
  readonly amount: bigint;
  /** 0x-prefixed lowercase token id. */
  readonly tokenId: string;
  /** Token symbol from the network config, or the token id when the token is not configured. */
  readonly tokenName: string;
  /** Token decimals from the network config, or null when the token is not configured. */
  readonly decimals: number | null;
  /** Submission time, ISO 8601 UTC with millisecond precision. */
  readonly timestamp: string;
  readonly timestampMs: number;
  /** Exact submission time in epoch nanoseconds; compare with this, not timestampMs. */
  readonly timestampNs: bigint;
  /** Fast explorer page for the transaction. */
  readonly explorerUrl: string;
}

export interface ExplorerTransfersPage {
  /** Value-moving transfers touching the address, in the requested order. */
  readonly transfers: readonly NetworkTransfer[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  /**
   * Oldest submission time among all rows of this page, including rows that were
   * skipped (non-value types). Lets callers stop paging once they pass a cutoff.
   */
  readonly oldestTimestampMs: number | null;
  /** Newest submission time among all rows of this page, including skipped rows. */
  readonly newestTimestampMs: number | null;
}

export interface ListTransfersParams {
  /** fast1… address whose transfers to list. */
  readonly address: string;
  /** Match the address as sender (`from`) or recipient (`to`). */
  readonly side: 'from' | 'to';
  /** Page size, 1–100 (default 50). */
  readonly limit?: number;
  readonly order?: 'desc' | 'asc';
  /** `nextCursor` of the previous page. */
  readonly cursor?: string | null;
}

export interface ExplorerApiShape {
  /** One page of transfers for an address on the active network. */
  readonly listTransfers: (
    params: ListTransfersParams,
  ) => Effect.Effect<ExplorerTransfersPage, ExplorerUnavailableError | ExplorerNotConfiguredError>;
}

export class ExplorerApi extends Context.Tag('ExplorerApi')<ExplorerApi, ExplorerApiShape>() {}

// ── Pure parsing ──────────────────────────────────────────────────────────────

const HEX_AMOUNT = /^(0x)?[0-9a-fA-F]+$/;
const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;
/** A Fast transaction hash: 32 bytes of hex. */
const HEX_HASH = /^(0x)?[0-9a-fA-F]{64}$/;

/** A well-formed Fast address: bech32m, `fast` prefix, 32-byte payload. */
const isFastAddress = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const decoded = bech32m.decode(value);
    return decoded.prefix === 'fast' && bech32m.fromWords(decoded.words).length === 32;
  } catch {
    return false;
  }
};

/** Parse the explorer's amount encoding: hex base units, normally without a `0x` prefix (`186a0` = 100000). */
export const parseExplorerAmount = (value: unknown): bigint | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_AMOUNT.test(trimmed)) return null;
  return BigInt(trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`);
};

/**
 * `YYYY-MM-DD`, optionally followed by `THH:MM`, `:SS`, a fraction of any
 * precision, and a zone (`Z` or `±HH:MM` / `±HHMM`).
 */
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parse an ISO 8601 timestamp to epoch **nanoseconds**, keeping the full
 * fraction (the explorer reports microseconds; digits beyond nanoseconds are
 * truncated). Strings without a zone are read as UTC. Strict: other formats
 * (`10/02/2026`) and impossible dates or times (`2026-02-30`, `24:00`) are
 * rejected rather than normalized, so a typo cannot silently shift the time.
 * Use this, not the millisecond form, wherever times are compared: two
 * instants in the same millisecond are still ordered correctly.
 */
export const parseIsoTimestampNs = (value: unknown): bigint | null => {
  if (typeof value !== 'string') return null;
  const m = ISO_8601.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((part) => Number(part ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  // Day must exist in that month (Date.UTC would roll 2026-02-30 over to March 2).
  if (day > daysInMonth(year, month)) return null;
  let offsetMinutes = 0;
  const zone = m[8];
  if (zone !== undefined && zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const zoneHours = Number(digits.slice(0, 2));
    const zoneMinutes = Number(digits.slice(2, 4));
    if (zoneHours > 23 || zoneMinutes > 59) return null;
    offsetMinutes = sign * (zoneHours * 60 + zoneMinutes);
  }
  // setUTCFullYear, unlike Date.UTC, does not remap years 0-99 to 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const wholeSecondsMs = date.getTime() - offsetMinutes * 60_000;
  if (!Number.isFinite(wholeSecondsMs)) return null;
  const fractionNs = BigInt((m[7] ?? '').slice(0, 9).padEnd(9, '0'));
  return BigInt(wholeSecondsMs) * 1_000_000n + fractionNs;
};

/**
 * Epoch milliseconds of an ISO 8601 timestamp (see parseIsoTimestampNs), with
 * the fraction truncated to the millisecond. Fine for display and coarse
 * windows; compare exact instants with the nanosecond form.
 */
export const parseIsoTimestamp = (value: unknown): number | null => {
  const ns = parseIsoTimestampNs(value);
  return ns === null ? null : nsToMs(ns);
};

/** Floor a nanosecond epoch to milliseconds (also correct before 1970). */
export const nsToMs = (ns: bigint): number => {
  const ms = ns / 1_000_000n;
  return Number(ns < 0n && ns % 1_000_000n !== 0n ? ms - 1n : ms);
};

/** Proleptic Gregorian month length, valid for every four-digit year. */
const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const normalizeHex = (value: string): string => `0x${value.replace(/^0x/i, '').toLowerCase()}`;

/**
 * Validate one row. Every row needs a 32-byte transaction hash, Fast addresses
 * as sender and recipient, and an ISO 8601 submission time; a value-moving row
 * (TokenTransfer, Mint, Burn) also needs a hex amount and a 32-byte token id.
 * Returns the reason when the row is malformed. Rows of other types (e.g.
 * `ExternalClaim`) need no amount and are filtered out later by normalizeTransfer.
 */
const parseRow = (raw: unknown): ExplorerTransferRow | string => {
  if (raw === null || typeof raw !== 'object') return 'is not an object';
  const r = raw as Record<string, unknown>;
  if (typeof r.hash !== 'string' || !HEX_HASH.test(r.hash)) return 'has no 32-byte "hash"';
  if (!isFastAddress(r.from)) return 'has a "from" that is not a Fast address';
  if (!isFastAddress(r.to)) return 'has a "to" that is not a Fast address';
  const timestampNs = parseIsoTimestampNs(r.submission_timestamp);
  if (timestampNs === null) return 'has no ISO 8601 "submission_timestamp"';
  const timestampMs = nsToMs(timestampNs);
  const type = typeof r.type === 'string' ? r.type : '';
  const tokenId = typeof r.token_id === 'string' && HEX_TOKEN_ID.test(r.token_id) ? normalizeHex(r.token_id) : null;
  const amount = parseExplorerAmount(r.amount);
  const isValueRow = (VALUE_TRANSFER_TYPES as readonly string[]).includes(type);
  if (isValueRow && (amount === null || tokenId === null)) {
    return `is a ${type} without a valid "amount" and "token_id"`;
  }
  // `hash-op_index` identifies a value operation (de-duplication relies on it),
  // so a value row needs a real index; other rows are filtered out later.
  const validIndex = typeof r.op_index === 'number' && Number.isSafeInteger(r.op_index) && r.op_index >= 0;
  if (isValueRow && !validIndex) return `is a ${type} without a valid "op_index"`;
  const opIndex = validIndex ? (r.op_index as number) : 0;
  return {
    hash: normalizeHex(r.hash),
    from: r.from,
    to: r.to,
    type,
    tokenId,
    amount,
    opIndex,
    timestampMs,
    timestampNs,
  };
};

/**
 * Validate a `/explorer/transfers` response body. Fails (returns a reason string)
 * when the envelope or any row is malformed: a page with a broken row is not a
 * complete answer (the broken row could be the payment being waited for), so it
 * surfaces as EXPLORER_UNAVAILABLE rather than being silently shortened.
 */
export const parseExplorerTransfersResponse = (body: unknown): ExplorerRowsPage | string => {
  if (body === null || typeof body !== 'object') return 'response is not a JSON object';
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.transfers)) return 'response has no "transfers" array';
  // Paging metadata must be consistent: treating a broken "more pages" signal
  // as the end of the feed would silently drop older transfers.
  if (typeof b.has_more !== 'boolean') return 'response has no boolean "has_more"';
  if (b.next_cursor !== undefined && b.next_cursor !== null && typeof b.next_cursor !== 'string') {
    return 'response has a "next_cursor" that is not a string';
  }
  const nextCursor = typeof b.next_cursor === 'string' && b.next_cursor.length > 0 ? b.next_cursor : null;
  if (b.has_more && nextCursor === null) return 'response says "has_more" but has no "next_cursor"';
  const rows: ExplorerTransferRow[] = [];
  for (const [index, raw] of b.transfers.entries()) {
    const row = parseRow(raw);
    if (typeof row === 'string') return `transfer row ${index} ${row}`;
    rows.push(row);
  }
  return { rows, hasMore: b.has_more, nextCursor };
};

/**
 * Turn a validated row into a value transfer relative to `address`, or undefined
 * when the row moves no value (no amount/token, e.g. `ExternalClaim`), is of an
 * unknown type, or does not involve the address.
 */
export const normalizeTransfer = (row: ExplorerTransferRow, address: string, network: NetworkConfig): NetworkTransfer | undefined => {
  if (!(VALUE_TRANSFER_TYPES as readonly string[]).includes(row.type)) return undefined;
  if (row.amount === null || row.tokenId === null) return undefined;
  const self = address.toLowerCase();
  const isFrom = row.from.toLowerCase() === self;
  const isTo = row.to.toLowerCase() === self;
  if (!isFrom && !isTo) return undefined;
  const direction: TransferDirection = isFrom && isTo ? 'self' : isTo ? 'in' : 'out';
  const token = lookupFastTokenById(network, row.tokenId);
  return {
    hash: row.hash,
    opIndex: row.opIndex,
    type: row.type as ValueTransferType,
    from: row.from,
    to: row.to,
    direction,
    counterparty: direction === 'in' ? row.from : row.to,
    amount: row.amount,
    tokenId: row.tokenId,
    tokenName: token?.name ?? row.tokenId,
    decimals: token?.decimals ?? null,
    timestamp: new Date(row.timestampMs).toISOString(),
    timestampMs: row.timestampMs,
    timestampNs: row.timestampNs,
    explorerUrl: `${network.explorerUrl.replace(/\/+$/, '')}/txs/${row.hash}`,
  };
};

// ── HTTP ──────────────────────────────────────────────────────────────────────

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
    return `request timed out after ${EXPLORER_REQUEST_TIMEOUT_MS / 1000}s`;
  }
  return cause instanceof Error ? cause.message : String(cause);
};

/**
 * Abort when either signal aborts. `AbortSignal.any` only exists from Node
 * 18.17 / 20.3; on older runtimes the two signals are combined by hand, so an
 * interrupted command (timeout, Ctrl-C, a failed sibling request) still
 * cancels the in-flight fetch instead of waiting for the request timeout.
 */
export const anySignal = (signals: readonly AbortSignal[]): AbortSignal => {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([...signals]);
  const controller = new AbortController();
  // Once any input aborts, detach from all of them, so a long-lived input (the
  // command's interruption signal) does not collect a listener per request.
  // Requests always pair it with a timeout signal, which aborts within 10 s.
  const listeners: Array<readonly [AbortSignal, () => void]> = [];
  const detach = () => {
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
    listeners.length = 0;
  };
  for (const signal of signals) {
    if (signal.aborted) {
      detach();
      controller.abort(signal.reason);
      break;
    }
    const listener = () => {
      detach();
      controller.abort(signal.reason);
    };
    listeners.push([signal, listener]);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
};

const requestSignal = (interrupt: AbortSignal): AbortSignal => anySignal([interrupt, AbortSignal.timeout(EXPLORER_REQUEST_TIMEOUT_MS)]);

/** Fetch and validate one page of raw rows. */
export const fetchExplorerRows = (baseUrl: string, params: ListTransfersParams): Effect.Effect<ExplorerRowsPage, ExplorerUnavailableError> => {
  const query = new URLSearchParams({
    [params.side]: params.address,
    limit: String(Math.min(EXPLORER_MAX_PAGE_SIZE, Math.max(1, Math.floor(params.limit ?? DEFAULT_PAGE_SIZE)))),
    order: params.order ?? 'desc',
  });
  if (params.cursor) query.set('cursor', params.cursor);
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/explorer/transfers`;
  const url = `${endpoint}?${query.toString()}`;

  return Effect.tryPromise({
    try: async (signal) => {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: requestSignal(signal) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new Error('response is not valid JSON');
      }
    },
    catch: (cause) => new ExplorerUnavailableError({ reason: describeFailure(cause), cause }),
  }).pipe(
    Effect.flatMap((body) => {
      const page = parseExplorerTransfersResponse(body);
      return typeof page === 'string' ? Effect.fail(new ExplorerUnavailableError({ reason: page })) : Effect.succeed(page);
    }),
  );
};

/** List one normalized page for an address, against an already-resolved network config. */
export const listTransfersOn = (
  network: NetworkConfig,
  networkName: string,
  params: ListTransfersParams,
): Effect.Effect<ExplorerTransfersPage, ExplorerUnavailableError | ExplorerNotConfiguredError> => {
  if (!network.explorerApiUrl) return Effect.fail(new ExplorerNotConfiguredError({ network: networkName }));
  return fetchExplorerRows(network.explorerApiUrl, params).pipe(
    Effect.map((page) => ({
      transfers: page.rows.flatMap((row) => normalizeTransfer(row, params.address, network) ?? []),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      oldestTimestampMs: page.rows.length === 0 ? null : Math.min(...page.rows.map((row) => row.timestampMs)),
      newestTimestampMs: page.rows.length === 0 ? null : Math.max(...page.rows.map((row) => row.timestampMs)),
    })),
  );
};

/** Bound to the active network (`--network` or the default), resolved lazily per call. */
export const ExplorerApiLive = Layer.effect(
  ExplorerApi,
  Effect.gen(function* () {
    const networks = yield* NetworkConfigService;
    const config = yield* ClientConfig;
    return {
      listTransfers: (params) =>
        networks.resolve(config.network).pipe(
          Effect.mapError((e) => new ExplorerUnavailableError({ reason: e.message, cause: e })),
          Effect.flatMap((network) => listTransfersOn(network, config.network, params)),
        ),
    };
  }),
);
