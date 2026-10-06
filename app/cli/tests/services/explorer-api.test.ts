import { Effect, Fiber, Layer, Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerNotConfiguredError, ExplorerUnavailableError } from '../../src/errors/index.js';
import type { NetworkConfig } from '../../src/schemas/networks.js';
import {
  anySignal,
  ExplorerApi,
  ExplorerApiLive,
  fetchExplorerRows,
  listTransfersOn,
  type ListTransfersParams,
  normalizeTransfer,
  parseExplorerAmount,
  parseExplorerTransfersResponse,
  parseIsoTimestamp,
  parseIsoTimestampNs,
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

  it('keeps the full fraction in nanoseconds, and floors it to milliseconds for the ms form', () => {
    const base = BigInt(Date.UTC(2026, 9, 2, 3)) * 1_000_000n;
    expect(parseIsoTimestampNs('2026-10-02T03:00:00.000500Z')).toBe(base + 500_000n);
    expect(parseIsoTimestampNs('2026-10-02T03:00:00.000900Z')).toBe(base + 900_000n);
    expect(parseIsoTimestampNs('2026-10-02T03:00:00.123456789Z')).toBe(base + 123_456_789n);
    expect(parseIsoTimestampNs('2026-10-02T03:00:00.1234567891Z')).toBe(base + 123_456_789n);
    expect(parseIsoTimestampNs('2026-10-02T06:00:00.5+03:00')).toBe(base + 500_000_000n);
    // Both of the first two fall in the same millisecond, but stay ordered in nanoseconds.
    expect(parseIsoTimestamp('2026-10-02T03:00:00.000500Z')).toBe(parseIsoTimestamp('2026-10-02T03:00:00.000900Z'));
    expect(parseIsoTimestampNs('2026-10-02T03:00:00.000500Z')! < parseIsoTimestampNs('2026-10-02T03:00:00.000900Z')!).toBe(true);
    // Before 1970 the millisecond form still floors (not truncates toward zero).
    expect(parseIsoTimestamp('1969-12-31T23:59:59.9995Z')).toBe(-1);
  });

  it('keeps years 0000-0099 as written instead of remapping them to 1900-1999', () => {
    const utc = (year: number, month: number, day: number) => {
      const d = new Date(0);
      d.setUTCFullYear(year, month - 1, day);
      return d.getTime();
    };
    expect(parseIsoTimestamp('0099-01-01')).toBe(utc(99, 1, 1));
    expect(new Date(parseIsoTimestamp('0099-01-01T00:00:00Z')!).getUTCFullYear()).toBe(99);
    // Proleptic Gregorian leap rules: 0000 and 2000 are leap years, 1900 is not.
    expect(parseIsoTimestamp('0000-02-29')).toBe(utc(0, 2, 29));
    expect(parseIsoTimestamp('2000-02-29')).toBe(Date.UTC(2000, 1, 29));
    expect(parseIsoTimestamp('1900-02-29')).toBeNull();
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

  it('keeps paging fields for a well-formed page', () => {
    const page = parseExplorerTransfersResponse({
      transfers: [rawTransfer(), rawTransfer({ hash: hashOf(2), type: 'ExternalClaim', amount: undefined, token_id: undefined })],
      has_more: true,
      next_cursor: 'abc',
    });
    if (typeof page === 'string') throw new Error(page);
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('abc');
  });

  it.each(['JoinCommittee', 'LeaveCommittee', 'ChangeCommittee'])('accepts a %s row without a recipient alongside a transfer', (type) => {
    const page = parseExplorerTransfersResponse({
      transfers: [rawTransfer({ hash: hashOf(2), from: ME, to: null, type, token_id: undefined, amount: undefined }), rawTransfer()],
      has_more: true,
      next_cursor: 'next-page',
    });
    if (typeof page === 'string') throw new Error(page);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]).toMatchObject({ type, to: null });
    expect(normalizeTransfer(page.rows[0]!, ME, testnet)).toBeUndefined();
    expect(page.rows[1]!.hash).toBe(hashOf(1));
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('next-page');
  });

  it('accepts real explorer rows of every type seen on mainnet (captured 2026-10-02)', () => {
    const real = [
      {
        hash: '0x5ce61e871b65ca16ba0268033179bc97373800e37b00c92384ca190ff3911312',
        from: 'fast19tmxy0pxjcz7qcf6ljh9qc774seg3vq4wwgmceutmy6el2pvehmsm9ju9y',
        to: 'fast19tmxy0pxjcz7qcf6ljh9qc774seg3vq4wwgmceutmy6el2pvehmsm9ju9y',
        nonce: 0,
        submission_timestamp: '2026-03-21T07:07:54.690331Z',
        type: 'TokenCreation',
        op_index: 0,
        token_id: '0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130',
        amount: '0',
      },
      {
        hash: '0x0bb6334ae98b9d6d97b52031785bd2036cc3096e17e4e1ca0c046becfcd19108',
        from: 'fast19tmxy0pxjcz7qcf6ljh9qc774seg3vq4wwgmceutmy6el2pvehmsm9ju9y',
        to: 'fast1chp8tv980ra7kjxttt5letd3rghfw3gkzdre9x9c73pkvg3gu5nqq5lhmp',
        nonce: 2,
        submission_timestamp: '2026-03-22T14:24:09.316189Z',
        type: 'TokenTransfer',
        op_index: 0,
        token_id: '0x3dd3a74b4228142da11d308ccb52377f1b9e8c1e834ddf29b0eb6695c3616bdd',
        amount: 'f4240',
      },
      {
        hash: '0x3d704bbeb425f43fa6f7e510fb74fca3034f3e96fdd080e1931fd83137579887',
        from: 'fast19tmxy0pxjcz7qcf6ljh9qc774seg3vq4wwgmceutmy6el2pvehmsm9ju9y',
        to: 'fast19tmxy0pxjcz7qcf6ljh9qc774seg3vq4wwgmceutmy6el2pvehmsm9ju9y',
        nonce: 5,
        submission_timestamp: '2026-03-23T02:35:10.807534Z',
        type: 'TokenManagement',
        op_index: 0,
        token_id: '0x3dd3a74b4228142da11d308ccb52377f1b9e8c1e834ddf29b0eb6695c3616bdd',
      },
      {
        hash: '0xca23edc6e791dbbb820ffd172f37500d9afa0eef39ccc6f6a6fca0cc5e57728b',
        from: 'fast1yvdnfx2c6urkp0dgq0cuxcl02lyvddw0crl96l7qvchka5nrqrksw88cnv',
        to: 'fast1yvdnfx2c6urkp0dgq0cuxcl02lyvddw0crl96l7qvchka5nrqrksw88cnv',
        nonce: 0,
        submission_timestamp: '2026-03-23T03:54:58.858292Z',
        type: 'ExternalClaim',
        op_index: 0,
      },
      {
        hash: '0x32f11982d409f3eb8d7ea96580c43c866e2d982a7b531155c42cb3659cf9bca8',
        from: 'fast17lqf2st89vqwm9yrgv2nhzx0mznqe0uukglkcl55lmecsgq9247qej58nf',
        to: 'fast1v4r7z3z5mfmaxqs7pwcy32dv0sdstdwajxkuezklvmx8zxjw4j8qjq3k8y',
        nonce: 123,
        submission_timestamp: '2026-09-30T16:56:18.638810Z',
        type: 'Mint',
        op_index: 0,
        token_id: '0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130',
        amount: '7a120',
      },
      {
        hash: '0xf2ea8b520fc41243df67bee0f139a8e2889857bdf4486515b3fceedf53c9710b',
        from: 'fast17lqf2st89vqwm9yrgv2nhzx0mznqe0uukglkcl55lmecsgq9247qej58nf',
        to: 'fast17lqf2st89vqwm9yrgv2nhzx0mznqe0uukglkcl55lmecsgq9247qej58nf',
        nonce: 122,
        submission_timestamp: '2026-09-30T16:55:38.337474Z',
        type: 'Burn',
        op_index: 0,
        token_id: '0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130',
        amount: '7a120',
      },
    ];
    const page = parseExplorerTransfersResponse({ transfers: real, has_more: false, next_cursor: null });
    if (typeof page === 'string') throw new Error(page);
    expect(page.rows.map((r) => r.type)).toEqual(['TokenCreation', 'TokenTransfer', 'TokenManagement', 'ExternalClaim', 'Mint', 'Burn']);
    expect(page.rows[4]!.amount).toBe(500_000n);
  });

  it('rejects the whole page when any row is malformed, naming the row', () => {
    const at = (bad: unknown) => parseExplorerTransfersResponse({ transfers: [rawTransfer(), bad], has_more: false, next_cursor: null });
    expect(at(42)).toBe('transfer row 1 is not an object');
    expect(at({ hash: 'nope' })).toBe('transfer row 1 has no 32-byte "hash"');
    expect(at(rawTransfer({ submission_timestamp: 'never' }))).toBe('transfer row 1 has no ISO 8601 "submission_timestamp"');
    expect(at(rawTransfer({ type: 'TokenTransfer', amount: undefined }))).toBe(
      'transfer row 1 is a TokenTransfer without a valid "amount" and "token_id"',
    );
    expect(at(rawTransfer({ type: 'Mint', token_id: 'xyz' }))).toBe('transfer row 1 is a Mint without a valid "amount" and "token_id"');
    for (const opIndex of [undefined, null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      expect(at(rawTransfer({ op_index: opIndex })), String(opIndex)).toBe('transfer row 1 is a TokenTransfer without a valid "op_index"');
    }
  });

  it('rejects rows without a 32-byte hash or with a sender/recipient that is not a Fast address', () => {
    const evm = `0x${'aa'.repeat(20)}`;
    const wrongPrefix = 'tfast1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsmkez2q';
    const malformed = [
      rawTransfer({ hash: '0x1' }),
      rawTransfer({ hash: `0x${'ab'.repeat(31)}` }),
      rawTransfer({ hash: `0x${'zz'.repeat(32)}` }),
      rawTransfer({ from: '' }),
      rawTransfer({ from: undefined }),
      rawTransfer({ to: evm }),
      rawTransfer({ to: null }),
      rawTransfer({ from: wrongPrefix }),
      rawTransfer({ from: `${LEO.slice(0, -1)}x` }), // bad checksum
    ];
    for (const row of malformed) {
      const page = parseExplorerTransfersResponse({ transfers: [rawTransfer(), row], has_more: false, next_cursor: null });
      expect(typeof page, JSON.stringify(row)).toBe('string');
    }
    const ok = parseExplorerTransfersResponse({ transfers: [rawTransfer()], has_more: false, next_cursor: null });
    if (typeof ok === 'string') throw new Error(ok);
    expect(ok.rows[0]!.from).toBe(LEO);
  });

  it('rejects inconsistent paging metadata instead of treating it as the end of the feed', () => {
    expect(parseExplorerTransfersResponse({ transfers: [], has_more: true, next_cursor: null })).toBe(
      'response says "has_more" but has no "next_cursor"',
    );
    expect(parseExplorerTransfersResponse({ transfers: [], has_more: true, next_cursor: '' })).toBe(
      'response says "has_more" but has no "next_cursor"',
    );
    expect(parseExplorerTransfersResponse({ transfers: [], has_more: true })).toBe('response says "has_more" but has no "next_cursor"');
    expect(parseExplorerTransfersResponse({ transfers: [], has_more: 'yes', next_cursor: 'c' })).toBe('response has no boolean "has_more"');
    expect(parseExplorerTransfersResponse({ transfers: [] })).toBe('response has no boolean "has_more"');
    expect(parseExplorerTransfersResponse({ transfers: [], has_more: false, next_cursor: 42 })).toBe(
      'response has a "next_cursor" that is not a string',
    );
  });

  it('accepts the last page with or without a cursor', () => {
    for (const body of [
      { transfers: [], has_more: false, next_cursor: null },
      { transfers: [], has_more: false },
      { transfers: [], has_more: false, next_cursor: 'stale' },
    ]) {
      const page = parseExplorerTransfersResponse(body);
      if (typeof page === 'string') throw new Error(page);
      expect(page.hasMore).toBe(false);
    }
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
      timestampNs: BigInt(Date.UTC(2026, 9, 2, 2, 59, 49)) * 1_000_000n + 705_580_000n,
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

  it('classifies a self-addressed Burn as outgoing, not a self transfer', () => {
    const [burn] = transfersFor(ME, [rawTransfer({ type: 'Burn', from: ME, to: ME })]);
    expect(burn).toMatchObject({ type: 'Burn', direction: 'out', from: ME, to: ME });
  });

  it('keeps Mint rows (EVM → Fast deposits) as incoming from the bridge account', () => {
    const [t] = transfersFor(ME, [rawTransfer({ type: 'Mint', from: BRIDGE, amount: 'f4240' })]);
    expect(t).toMatchObject({ type: 'Mint', direction: 'in', from: BRIDGE, amount: 1_000_000n });
  });

  it('skips rows that move no value, have unknown types, or do not involve the address', () => {
    const rows = [
      rawTransfer({ type: 'ExternalClaim', op_index: undefined, amount: undefined, token_id: undefined }),
      rawTransfer({ type: 'ExternalClaim', from: ME, to: ME, amount: undefined, token_id: undefined }),
      rawTransfer({ type: 'ExternalClaim', amount: null, token_id: null }),
      rawTransfer({ type: 'TokenCreation', amount: undefined, token_id: undefined }),
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
    const parsed = parseExplorerTransfersResponse({ transfers: [rawTransfer()], has_more: false, next_cursor: null });
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

  it('keeps transfers and page bounds when a committee operation has no recipient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          transfers: [
            rawTransfer({
              hash: hashOf(2),
              from: ME,
              to: null,
              type: 'LeaveCommittee',
              token_id: undefined,
              amount: undefined,
              submission_timestamp: '2026-10-01T00:00:00Z',
            }),
            rawTransfer({ from: ME, to: LEO }),
          ],
          has_more: true,
          next_cursor: 'cursor-2',
        }),
      ),
    );

    const page = await Effect.runPromise(listTransfersOn(testnet, 'testnet', { address: ME, side: 'from' }));
    expect(page.transfers.map((transfer) => transfer.hash)).toEqual([hashOf(1)]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.oldestTimestampMs).toBe(Date.UTC(2026, 9, 1));
    expect(page.newestTimestampMs).toBe(Date.UTC(2026, 9, 2, 2, 59, 49, 705));
  });

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

  it('reports a page with a malformed row as EXPLORER_UNAVAILABLE, so it cannot be taken for a payment or a complete page', async () => {
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

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected a typed failure');
    expect(exit.cause.error).toBeInstanceOf(ExplorerUnavailableError);
    expect((exit.cause.error as ExplorerUnavailableError).reason).toBe('transfer row 0 has no 32-byte "hash"');
  });

  it('reports a page with "has_more" but no cursor as EXPLORER_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ transfers: [rawTransfer()], has_more: true, next_cursor: null })),
    );

    const exit = await run({ address: ME, side: 'to' });

    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected a typed failure');
    expect(exit.cause.error).toBeInstanceOf(ExplorerUnavailableError);
    expect((exit.cause.error as ExplorerUnavailableError).errorCode).toBe('EXPLORER_UNAVAILABLE');
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

describe('anySignal', () => {
  /** Run `fn` as if on a Node release without AbortSignal.any (before 18.17 / 20.3). */
  const withoutAbortSignalAny = async (fn: () => Promise<void> | void) => {
    const original = AbortSignal.any;
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
    try {
      await fn();
    } finally {
      Object.defineProperty(AbortSignal, 'any', { value: original, configurable: true, writable: true });
    }
  };

  it('aborts when any input aborts, with or without AbortSignal.any', async () => {
    const check = () => {
      for (const which of [0, 1]) {
        const inputs = [new AbortController(), new AbortController()];
        const combined = anySignal(inputs.map((c) => c.signal));
        expect(combined.aborted).toBe(false);
        inputs[which]!.abort(new Error(`stop ${which}`));
        expect(combined.aborted).toBe(true);
        expect((combined.reason as Error).message).toBe(`stop ${which}`);
      }
      const already = new AbortController();
      already.abort('done');
      expect(anySignal([new AbortController().signal, already.signal]).aborted).toBe(true);
    };
    check();
    await withoutAbortSignalAny(check);
  });

  it('without AbortSignal.any, detaches from every input once one aborts', async () => {
    await withoutAbortSignalAny(() => {
      const interrupt = new AbortController();
      const timeout = new AbortController();
      const added = vi.spyOn(interrupt.signal, 'addEventListener');
      const removed = vi.spyOn(interrupt.signal, 'removeEventListener');

      const combined = anySignal([interrupt.signal, timeout.signal]);
      timeout.abort(new Error('request timed out'));

      expect(combined.aborted).toBe(true);
      // The long-lived interruption signal keeps no listener from this request.
      expect(added).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0]![1]);
    });
  });

  it('cancels an in-flight explorer request when the command is interrupted, even without AbortSignal.any', async () => {
    await withoutAbortSignalAny(async () => {
      let seen: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              seen = init?.signal ?? undefined;
              seen?.addEventListener('abort', () => reject(seen?.reason), { once: true });
            }),
        ),
      );

      const fiber = Effect.runFork(fetchExplorerRows('https://api.fast.xyz', { address: ME, side: 'to' }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(seen?.aborted).toBe(false);
      await Effect.runPromise(Fiber.interrupt(fiber));

      expect(seen?.aborted).toBe(true);
    });
  });
});
