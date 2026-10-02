import { Effect, Layer, Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerNotConfiguredError, ExplorerUnavailableError } from '../../src/errors/index.js';
import type { NetworkConfig } from '../../src/schemas/networks.js';
import {
  ExplorerApi,
  ExplorerApiLive,
  type ListTransfersParams,
  normalizeTransfer,
  parseExplorerAmount,
  parseExplorerTransfersResponse,
  parseIsoTimestamp,
} from '../../src/services/api/explorer.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import { BRIDGE, FASTUSD_ID, hashOf, LEO, ME, mainnet, OTHER, rawTransfer, testnet, transfersFor, UNKNOWN_TOKEN_ID } from '../fixtures/explorer.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseExplorerAmount', () => {
  it('reads unprefixed hex base units', () => {
    expect(parseExplorerAmount('186a0')).toBe(100_000n); // 0.1 of a 6-decimal token
    expect(parseExplorerAmount('1')).toBe(1n);
    expect(parseExplorerAmount('f4240')).toBe(1_000_000n);
    expect(parseExplorerAmount('0x10')).toBe(16n);
  });

  it('treats an all-digit string as hex, not decimal', () => {
    expect(parseExplorerAmount('10')).toBe(16n);
  });

  it('rejects missing or malformed amounts', () => {
    expect(parseExplorerAmount(undefined)).toBeNull();
    expect(parseExplorerAmount(null)).toBeNull();
    expect(parseExplorerAmount('')).toBeNull();
    expect(parseExplorerAmount('12.5')).toBeNull();
    expect(parseExplorerAmount(100000)).toBeNull();
  });
});

describe('parseIsoTimestamp', () => {
  it('accepts millisecond and microsecond precision', () => {
    expect(parseIsoTimestamp('2026-09-23T02:02:00.371Z')).toBe(Date.UTC(2026, 8, 23, 2, 2, 0, 371));
    expect(parseIsoTimestamp('2026-10-02T02:59:49.705580Z')).toBe(Date.UTC(2026, 9, 2, 2, 59, 49, 705));
  });

  it('reads zone-less timestamps as UTC and rejects garbage', () => {
    expect(parseIsoTimestamp('2026-10-02T02:59:49.705580')).toBe(Date.UTC(2026, 9, 2, 2, 59, 49, 705));
    expect(parseIsoTimestamp('2026-10-02')).toBe(Date.UTC(2026, 9, 2));
    expect(parseIsoTimestamp('2026-10-02T05:00:00+03:00')).toBe(Date.UTC(2026, 9, 2, 2));
    expect(parseIsoTimestamp('yesterday')).toBeNull();
    expect(parseIsoTimestamp(1790909989705)).toBeNull();
  });

  it('accepts other ISO zone spellings and a minutes-only time', () => {
    expect(parseIsoTimestamp('2026-10-02T05:00:00+0300')).toBe(Date.UTC(2026, 9, 2, 2));
    expect(parseIsoTimestamp('2026-10-01T23:30:00-03:00')).toBe(Date.UTC(2026, 9, 2, 2, 30));
    expect(parseIsoTimestamp('2026-10-02T12:00')).toBe(Date.UTC(2026, 9, 2, 12));
    expect(parseIsoTimestamp('2024-02-29T00:00:00Z')).toBe(Date.UTC(2024, 1, 29));
  });

  it('rejects impossible dates and times instead of rolling them over', () => {
    for (const value of [
      '2026-02-30',
      '2025-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31T00:00:00Z',
      '2026-10-02T24:00:00Z',
      '2026-10-02T12:60:00Z',
      '2026-10-02T12:00:60Z',
      '2026-10-02T12:00:00+25:00',
    ]) {
      expect(parseIsoTimestamp(value), value).toBeNull();
    }
  });

  it('rejects non-ISO formats that Date.parse would accept', () => {
    for (const value of ['10/02/2026', 'Oct 2, 2026', '2026/10/02', 'Fri, 02 Oct 2026 12:00:00 GMT', '2026-10-2', '']) {
      expect(parseIsoTimestamp(value), value).toBeNull();
    }
  });
});

describe('parseExplorerTransfersResponse', () => {
  it('rejects bodies that are not the documented envelope', () => {
    expect(parseExplorerTransfersResponse(null)).toBe('response is not a JSON object');
    expect(parseExplorerTransfersResponse({ data: [] })).toBe('response has no "transfers" array');
  });

  it('drops malformed rows and keeps paging fields', () => {
    const page = parseExplorerTransfersResponse({
      transfers: [rawTransfer(), { hash: 'nope' }, rawTransfer({ submission_timestamp: 'never' }), 42],
      has_more: true,
      next_cursor: 'abc',
    });
    if (typeof page === 'string') throw new Error(page);
    expect(page.rows).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('abc');
  });

  it('drops rows without a 32-byte hash or with a sender/recipient that is not a Fast address', () => {
    const evm = `0x${'aa'.repeat(20)}`;
    const wrongPrefix = 'tfast1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsmkez2q';
    const malformed = [
      rawTransfer({ hash: '0x1' }),
      rawTransfer({ hash: `0x${'ab'.repeat(31)}` }),
      rawTransfer({ hash: `0x${'zz'.repeat(32)}` }),
      rawTransfer({ from: '' }),
      rawTransfer({ from: undefined }),
      rawTransfer({ to: evm }),
      rawTransfer({ from: wrongPrefix }),
      rawTransfer({ from: `${LEO.slice(0, -1)}x` }), // bad checksum
    ];
    const page = parseExplorerTransfersResponse({ transfers: [...malformed, rawTransfer()], has_more: false, next_cursor: null });
    if (typeof page === 'string') throw new Error(page);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.hash).toBe(hashOf(1));
    expect(page.rows[0]!.from).toBe(LEO);
  });

  it('reports no more pages when the cursor is missing', () => {
    const page = parseExplorerTransfersResponse({ transfers: [], has_more: true, next_cursor: null });
    if (typeof page === 'string') throw new Error(page);
    expect(page.hasMore).toBe(false);
  });
});

describe('normalizeTransfer', () => {
  it('normalizes an incoming TokenTransfer relative to the queried address', () => {
    const [t] = transfersFor(ME, [rawTransfer({ hash: `0x${'AB'.repeat(32)}` })]);
    expect(t).toEqual({
      hash: `0x${'ab'.repeat(32)}`,
      opIndex: 0,
      type: 'TokenTransfer',
      from: LEO,
      to: ME,
      direction: 'in',
      counterparty: LEO,
      amount: 100_000n,
      tokenId: testnet.defaultToken!.tokenId,
      tokenName: 'testUSDC',
      decimals: 6,
      timestamp: '2026-10-02T02:59:49.705Z',
      timestampMs: Date.UTC(2026, 9, 2, 2, 59, 49, 705),
      explorerUrl: `https://testnet.explorer.fast.xyz/txs/0x${'ab'.repeat(32)}`,
    });
  });

  it('marks outgoing and self transfers', () => {
    const [out] = transfersFor(ME, [rawTransfer({ from: ME, to: LEO })]);
    expect(out!.direction).toBe('out');
    expect(out!.counterparty).toBe(LEO);
    const [self] = transfersFor(ME, [rawTransfer({ from: ME, to: ME })]);
    expect(self!.direction).toBe('self');
    expect(self!.counterparty).toBe(ME);
  });

  it('keeps Mint rows (EVM → Fast deposits) as incoming from the bridge account', () => {
    const [t] = transfersFor(ME, [rawTransfer({ type: 'Mint', from: BRIDGE, amount: 'f4240' })]);
    expect(t).toMatchObject({ type: 'Mint', direction: 'in', from: BRIDGE, amount: 1_000_000n });
  });

  it('skips rows that move no value, have unknown types, or do not involve the address', () => {
    const rows = [
      rawTransfer({ type: 'ExternalClaim', from: ME, to: ME, amount: undefined, token_id: undefined }),
      rawTransfer({ type: 'ExternalClaim', amount: null, token_id: null }),
      rawTransfer({ type: 'TokenTransfer', amount: undefined }),
      rawTransfer({ type: 'SomethingNew' }),
      rawTransfer({ from: LEO, to: OTHER }),
    ];
    expect(transfersFor(ME, rows)).toEqual([]);
  });

  it('labels unknown tokens by id with no decimals', () => {
    const [t] = transfersFor(ME, [rawTransfer({ token_id: UNKNOWN_TOKEN_ID, amount: '1' })]);
    expect(t).toMatchObject({ tokenName: UNKNOWN_TOKEN_ID, tokenId: UNKNOWN_TOKEN_ID, decimals: null, amount: 1n });
  });

  it("prefers the network's default token symbol over bridge names (fastUSD, not USDC, on mainnet)", () => {
    const [t] = transfersFor(ME, [rawTransfer({ token_id: FASTUSD_ID })], mainnet);
    expect(t).toMatchObject({ tokenName: 'fastUSD', decimals: 6, explorerUrl: `https://explorer.fast.xyz/txs/${hashOf(1)}` });
  });

  it('returns undefined for an address it does not involve', () => {
    const parsed = parseExplorerTransfersResponse({ transfers: [rawTransfer()] });
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(normalizeTransfer(parsed.rows[0]!, OTHER, testnet)).toBeUndefined();
  });
});

describe('ExplorerApiLive', () => {
  const run = (params: ListTransfersParams, network: NetworkConfig = testnet, networkName = 'testnet') =>
    Effect.runPromiseExit(
      Effect.flatMap(ExplorerApi, (api) => api.listTransfers(params)).pipe(
        Effect.provide(
          ExplorerApiLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(network) } as never),
                Layer.succeed(ClientConfig, {
                  json: true,
                  debug: false,
                  nonInteractive: true,
                  network: networkName,
                  account: Option.none(),
                  password: Option.none(),
                }),
              ),
            ),
          ),
        ),
      ),
    );

  it('queries the active network with the documented parameters and a request timeout', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      json({
        transfers: [
          rawTransfer({ hash: hashOf(2), submission_timestamp: '2026-10-02T03:00:00.000Z' }),
          rawTransfer({
            hash: hashOf(3),
            type: 'ExternalClaim',
            from: ME,
            amount: undefined,
            token_id: undefined,
            submission_timestamp: '2026-10-01T00:00:00Z',
          }),
        ],
        has_more: true,
        next_cursor: 'cursor-2',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const exit = await run({ address: ME, side: 'to', limit: 20, cursor: 'cursor-1' });

    if (exit._tag !== 'Success') throw new Error(String(exit.cause));
    expect(exit.value.transfers.map((t) => t.hash)).toEqual([hashOf(2)]);
    expect(exit.value.hasMore).toBe(true);
    expect(exit.value.nextCursor).toBe('cursor-2');
    // The skipped ExternalClaim row still counts for the page's time span.
    expect(exit.value.oldestTimestampMs).toBe(Date.UTC(2026, 9, 1));

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(`${url.origin}${url.pathname}`).toBe('https://testnet.api.fast.xyz/explorer/transfers');
    expect(Object.fromEntries(url.searchParams)).toEqual({ to: ME, limit: '20', order: 'desc', cursor: 'cursor-1' });
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('never turns a malformed row into a transfer, so it cannot be taken for a payment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          transfers: [
            rawTransfer({ hash: '0x1', submission_timestamp: '2026-10-02T03:00:00Z' }),
            rawTransfer({ hash: hashOf(4), from: '', submission_timestamp: '2026-10-02T03:00:00Z' }),
          ],
          has_more: false,
          next_cursor: null,
        }),
      ),
    );

    const exit = await run({ address: ME, side: 'to' });

    if (exit._tag !== 'Success') throw new Error(String(exit.cause));
    expect(exit.value.transfers).toEqual([]);
  });

  it('uses the mainnet API for mainnet and clamps the page size to 100', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => json({ transfers: [], has_more: false, next_cursor: null }));
    vi.stubGlobal('fetch', fetchMock);

    await run({ address: ME, side: 'from', limit: 500, order: 'asc' }, mainnet, 'mainnet');

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin).toBe('https://api.fast.xyz');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: ME, limit: '100', order: 'asc' });
  });

  it.each([
    ['an HTTP error', async () => new Response('nope', { status: 503 }), 'HTTP 503 from https://testnet.api.fast.xyz/explorer/transfers'],
    ['an invalid JSON body', async () => new Response('<html>', { status: 200 }), 'response is not valid JSON'],
    ['an unexpected body', async () => json({ items: [] }), 'response has no "transfers" array'],
    ['a timeout', async () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')), 'request timed out after 10s'],
    ['a transport error', async () => Promise.reject(new TypeError('fetch failed')), 'fetch failed'],
  ])('maps %s to EXPLORER_UNAVAILABLE', async (_label, impl, reason) => {
    vi.stubGlobal('fetch', vi.fn(impl));

    const exit = await run({ address: ME, side: 'to' });

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(ExplorerUnavailableError);
    expect((exit.cause.error as ExplorerUnavailableError).reason).toBe(reason);
    expect(exit.cause.error.errorCode).toBe('EXPLORER_UNAVAILABLE');
  });

  it('fails with EXPLORER_NOT_CONFIGURED, without a request, on a network with no explorer API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { explorerApiUrl: _, ...custom } = testnet;

    const exit = await run({ address: ME, side: 'to' }, custom, 'devnet');

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected failure');
    expect(exit.cause.error).toBeInstanceOf(ExplorerNotConfiguredError);
    expect(exit.cause.error.message).toContain('"devnet"');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
