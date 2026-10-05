import { Effect, Layer, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { infoHistory } from '../../src/commands/info/history.js';
import { ExplorerUnavailableError, NoDefaultAccountError } from '../../src/errors/index.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import type { NetworkConfig } from '../../src/schemas/networks.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { type AccountInfo, AccountStore } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import {
  BRIDGE,
  FASTUSD_ID,
  hashOf,
  LEO,
  ME,
  mainnet,
  mockExplorer,
  OTHER,
  page,
  rawTransfer,
  TESTUSDC_ID,
  testnet,
  transfersFor,
  UNKNOWN_TOKEN_ID,
} from '../fixtures/explorer.js';

const MY_EVM = `0x${'ee'.repeat(20)}`;
const EXTERNAL_EVM = `0x${'aa'.repeat(20)}`;

const account: AccountInfo = {
  kind: 'single',
  name: 'agent',
  fastAddress: ME,
  evmAddress: MY_EVM,
  isDefault: true,
  encrypted: false,
  createdAt: new Date(0).toISOString(),
};

const recipientAccount: AccountInfo = {
  kind: 'single',
  name: 'recipient',
  fastAddress: OTHER,
  evmAddress: `0x${'bb'.repeat(20)}`,
  isDefault: false,
  encrypted: false,
  createdAt: new Date(0).toISOString(),
};

const mainnetMultisig: AccountInfo = {
  kind: 'multisig',
  name: 'treasury',
  fastAddress: ME,
  multisigConfig: {
    version: 1,
    name: 'treasury',
    signers: [ME, LEO],
    quorum: 2,
    configNonce: '0',
    fastAddress: ME,
    network: 'mainnet',
  },
  isDefault: true,
  createdAt: new Date(0).toISOString(),
};

const entry = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  hash: hashOf(99),
  type: 'transfer',
  from: ME,
  to: LEO,
  amount: '1000000',
  formatted: '1',
  tokenName: 'testUSDC',
  tokenId: TESTUSDC_ID,
  network: 'testnet',
  status: 'confirmed',
  timestamp: '2026-10-02T01:00:00.000Z',
  explorerUrl: `https://testnet.explorer.fast.xyz/txs/${hashOf(99)}`,
  route: 'fast',
  chainId: null,
  ...overrides,
});

// Local entries: what this CLI recorded when it submitted transactions.
const localSend = entry({ hash: hashOf(10), timestamp: '2026-10-02T01:00:00.000Z' });
const localWithdraw = entry({
  hash: hashOf(11),
  to: EXTERNAL_EVM,
  route: 'fast-to-evm',
  status: 'pending',
  chainId: 421614,
  timestamp: '2026-10-02T01:30:00.000Z',
});
const localDeposit = entry({
  hash: `0x${'cd'.repeat(32)}`,
  from: MY_EVM,
  to: ME,
  route: 'evm-to-fast',
  status: 'confirmed',
  chainId: 421614,
  timestamp: '2026-10-02T00:30:00.000Z',
});
const otherAccountSend = entry({ hash: hashOf(12), from: OTHER, to: LEO, timestamp: '2026-10-02T00:45:00.000Z' });
const localEntries = [localWithdraw, localSend, otherAccountSend, localDeposit];

// Network feed for ME.
const incoming = transfersFor(ME, [rawTransfer({ hash: hashOf(1), submission_timestamp: '2026-10-02T03:00:00.123456Z' })])[0]!;
const self = transfersFor(ME, [rawTransfer({ hash: hashOf(4), from: ME, to: ME, submission_timestamp: '2026-10-02T02:30:00Z' })])[0]!;
const deposit = transfersFor(ME, [
  rawTransfer({ hash: hashOf(3), type: 'Mint', from: BRIDGE, amount: 'f4240', submission_timestamp: '2026-10-02T02:00:00Z' }),
])[0]!;
const sendTwin = transfersFor(ME, [
  rawTransfer({ hash: hashOf(10), from: ME, to: LEO, amount: 'f4240', submission_timestamp: '2026-10-02T01:00:00.400Z' }),
])[0]!;
const outgoing = transfersFor(ME, [
  rawTransfer({ hash: hashOf(5), from: ME, to: OTHER, amount: '1', submission_timestamp: '2026-10-02T00:10:00Z' }),
])[0]!;

const defaultFeed = mockExplorer((params) => Effect.succeed(page(params.side === 'to' ? [incoming, self, deposit] : [self, sendTwin, outgoing])));

interface Captured {
  tables: string[][][];
  results: Array<{ transactions: Array<Record<string, unknown>>; account: string | null; warnings: string[] }>;
  warnings: string[];
  statusUpdates: Array<[string, string]>;
}

const runHistory = async (
  args: Record<string, unknown>,
  opts: {
    entries?: HistoryEntry[];
    account?: AccountInfo | null;
    network?: NetworkConfig;
    networkName?: string;
    explorer?: ReturnType<typeof mockExplorer>;
    /** Value of the global --account flag. */
    accountName?: string;
    accounts?: AccountInfo[];
  } = {},
) => {
  const captured: Captured = { tables: [], results: [], warnings: [], statusUpdates: [] };
  const accountLookups: Array<Option.Option<string>> = [];
  const listCalls: Array<{ limit?: number; offset?: number }> = [];
  const explorer = opts.explorer ?? defaultFeed;
  const layer = Layer.mergeAll(
    Layer.succeed(HistoryStore, {
      // Like the SQLite store: newest first, honouring limit/offset.
      list: (filters: { limit?: number; offset?: number }) =>
        Effect.sync(() => {
          listCalls.push({ limit: filters.limit, offset: filters.offset });
          const offset = filters.offset ?? 0;
          return (opts.entries ?? localEntries).slice(offset, offset + (filters.limit ?? 20));
        }),
      updateStatus: (hash: string, status: string) => Effect.sync(() => void captured.statusUpdates.push([hash, status])),
    } as never),
    Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(opts.network ?? testnet) } as never),
    Layer.succeed(AccountStore, {
      list: () => Effect.succeed(opts.accounts ?? [account]),
      resolveAccount: (name: Option.Option<string>) => {
        accountLookups.push(name);
        return opts.account === null ? Effect.fail(new NoDefaultAccountError()) : Effect.succeed(opts.account ?? account);
      },
    } as never),
    Layer.succeed(ClientConfig, {
      json: true,
      debug: false,
      nonInteractive: true,
      network: opts.networkName ?? 'testnet',
      account: Option.fromNullable(opts.accountName),
      password: Option.none(),
    }),
    explorer.layer,
    Layer.succeed(Output, {
      humanTable: (_headers: string[], rows: string[][]) => Effect.sync(() => void captured.tables.push(rows)),
      humanLine: () => Effect.void,
      warn: (text: string) => Effect.sync(() => void captured.warnings.push(text)),
      ok: (data: unknown) => Effect.sync(() => void captured.results.push(data as Captured['results'][number])),
      fail: () => Effect.void,
      debug: () => Effect.void,
    } as never),
  );
  await Effect.runPromise(infoHistory.handler({ limit: 20, offset: 0, direction: 'all', ...args } as never).pipe(Effect.provide(layer)));
  const result = captured.results[0]!;
  return { ...captured, result, hashes: result.transactions.map((t) => t.hash), calls: explorer.calls, accountLookups, listCalls };
};

beforeEach(() => {
  // AllSet portal lookups for pending bridge entries: nothing confirmed by default.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: [] }))),
  );
  defaultFeed.calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('info history (network + local)', () => {
  it('rejects a multisig bound to another network before explorer reads', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([incoming])));

    await expect(runHistory({}, { account: mainnetMultisig, entries: [], explorer })).rejects.toThrow(
      'Multisig wallet "treasury" belongs to network "mainnet", but the active network is "testnet".',
    );
    expect(explorer.calls).toHaveLength(0);
  });

  it('merges incoming and outgoing network transfers with local entries, newest first', async () => {
    const { result, hashes, calls } = await runHistory({});

    expect(hashes).toEqual([hashOf(1), hashOf(4), hashOf(3), hashOf(11), hashOf(10), `0x${'cd'.repeat(32)}`, hashOf(5)]);
    expect(result.transactions.map((t) => [t.direction, t.source])).toEqual([
      ['in', 'network'],
      ['self', 'network'],
      ['in', 'network'],
      ['out', 'local'],
      ['out', 'local'],
      ['in', 'local'],
      ['out', 'network'],
    ]);
    expect(result.account).toBe(ME);
    expect(result.warnings).toEqual([]);
    expect(calls.map((c) => c.side).sort()).toEqual(['from', 'to']);
  });

  it('keeps local entries as they were and only adds direction and source', async () => {
    const { result } = await runHistory({});

    // The network twin of a CLI-sent transfer is dropped in favour of the local entry.
    expect(result.transactions.find((t) => t.hash === hashOf(10))).toEqual({ ...localSend, direction: 'out', source: 'local' });
  });

  it('shapes network rows like local entries', async () => {
    const { result } = await runHistory({});

    expect(result.transactions[0]).toEqual({
      hash: hashOf(1),
      type: 'transfer',
      from: LEO,
      to: ME,
      amount: '100000',
      formatted: '0.1',
      tokenName: 'testUSDC',
      tokenId: TESTUSDC_ID,
      network: 'testnet',
      status: 'confirmed',
      timestamp: '2026-10-02T03:00:00.123Z',
      explorerUrl: `https://testnet.explorer.fast.xyz/txs/${hashOf(1)}`,
      route: 'fast',
      chainId: null,
      direction: 'in',
      source: 'network',
    });
    expect(result.transactions.find((t) => t.hash === hashOf(3))).toMatchObject({ type: 'token-mint', from: BRIDGE, formatted: '1' });
  });

  it('--direction in returns only incoming transfers and reads only the incoming feed', async () => {
    const { result, hashes, calls } = await runHistory({ direction: 'in' });

    expect(hashes).toEqual([hashOf(1), hashOf(3), `0x${'cd'.repeat(32)}`]);
    expect(result.transactions.every((t) => t.direction === 'in')).toBe(true);
    expect(calls.map((c) => c.side)).toEqual(['to']);
  });

  it('--direction out returns only outgoing transfers and reads only the outgoing feed', async () => {
    const { hashes, calls } = await runHistory({ direction: 'out' });

    expect(hashes).toEqual([hashOf(11), hashOf(10), hashOf(5)]);
    expect(calls.map((c) => c.side)).toEqual(['from']);
  });

  it('--direction out includes an explorer Burn with the same sender and recipient', async () => {
    const burn = transfersFor(ME, [rawTransfer({ hash: hashOf(86), type: 'Burn', from: ME, to: ME })])[0]!;
    const explorer = mockExplorer((params) => Effect.succeed(page(params.side === 'from' ? [burn] : [])));
    const { result, hashes, calls } = await runHistory({ direction: 'out' }, { entries: [], explorer });

    expect(hashes).toEqual([hashOf(86)]);
    expect(result.transactions[0]).toMatchObject({ type: 'token-burn', direction: 'out', source: 'network' });
    expect(calls.map((c) => c.side)).toEqual(['from']);
  });

  it('--from filters by sender and skips the outgoing feed when the sender is someone else', async () => {
    const { hashes, calls } = await runHistory({ from: LEO });

    expect(hashes).toEqual([hashOf(1)]);
    expect(calls.map((c) => c.side)).toEqual(['to']);
  });

  it('--to filters by recipient', async () => {
    const { hashes, calls } = await runHistory({ to: OTHER });

    expect(hashes).toEqual([hashOf(5)]);
    expect(calls.map((c) => c.side)).toEqual(['from']);
  });

  it('falls back to local history with a warning when the explorer is unreachable', async () => {
    const explorer = mockExplorer(() =>
      Effect.fail(new ExplorerUnavailableError({ reason: 'HTTP 503 from https://testnet.api.fast.xyz/explorer/transfers' })),
    );

    const { result, hashes, warnings } = await runHistory({}, { explorer });

    expect(hashes).toEqual([hashOf(11), hashOf(10), `0x${'cd'.repeat(32)}`]);
    expect(result.transactions.every((t) => t.source === 'local')).toBe(true);
    const expected =
      'Could not read network history from the explorer API: HTTP 503 from https://testnet.api.fast.xyz/explorer/transfers. Showing local history only; incoming payments may be missing.';
    expect(result.warnings).toEqual([expected]);
    expect(warnings).toEqual([expected]);
  });

  it('drops all network rows when only one feed fails, rather than showing half the picture', async () => {
    const explorer = mockExplorer((params) =>
      params.side === 'to' ? Effect.fail(new ExplorerUnavailableError({ reason: 'request timed out after 10s' })) : Effect.succeed(page([outgoing])),
    );

    const { result } = await runHistory({}, { explorer });

    expect(result.transactions.every((t) => t.source === 'local')).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('shows local history with a warning on a network without an explorer API', async () => {
    const { explorerApiUrl: _, ...custom } = testnet;
    const explorer = mockExplorer(() => Effect.succeed(page([])));

    const { result, calls } = await runHistory({}, { network: custom, networkName: 'devnet', explorer });

    expect(calls).toHaveLength(0);
    expect(result.transactions.every((t) => t.source === 'local')).toBe(true);
    expect(result.warnings).toEqual(['Network "devnet" has no explorer API configured (explorerApiUrl); only local history is shown.']);
  });

  it('without any account, shows the whole local log (old behaviour) and warns', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([])));

    const { result, hashes, calls } = await runHistory({}, { account: null, explorer });

    expect(calls).toHaveLength(0);
    expect(hashes).toEqual([hashOf(11), hashOf(10), hashOf(12), `0x${'cd'.repeat(32)}`]);
    expect(result.transactions.map((t) => t.direction)).toEqual(['out', 'out', 'out', 'in']);
    expect(result.account).toBeNull();
    expect(result.warnings[0]).toContain('No account selected');
  });

  it('pages through the explorer with the cursor and applies --limit/--offset to the merged list', async () => {
    const at = (n: number, iso: string) => transfersFor(ME, [rawTransfer({ hash: hashOf(n), submission_timestamp: iso })])[0]!;
    const explorer = mockExplorer((params) =>
      Effect.succeed(
        params.cursor === null
          ? page([at(21, '2026-10-02T03:00:00Z'), at(22, '2026-10-02T02:50:00Z')], { hasMore: true, nextCursor: 'c1' })
          : page([at(23, '2026-10-02T02:40:00Z'), at(24, '2026-10-02T02:30:00Z')], { hasMore: true, nextCursor: 'c2' }),
      ),
    );

    const { hashes, calls } = await runHistory({ direction: 'in', limit: 2, offset: 1 }, { explorer });

    expect(hashes).toEqual([hashOf(22), hashOf(23)]);
    expect(calls.map((c) => [c.side, c.cursor, c.limit])).toEqual([
      ['to', null, 50],
      ['to', 'c1', 50],
    ]);
  });

  it('--limit 0 reads nothing from the explorer', async () => {
    const { result, calls } = await runHistory({ limit: 0 });

    expect(result.transactions).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('--token matches by symbol, id, or the id a symbol resolves to (USDC and fastUSD share an id on mainnet)', async () => {
    const usd = transfersFor(ME, [rawTransfer({ hash: hashOf(30), token_id: FASTUSD_ID })], mainnet)[0]!;
    const unknown = transfersFor(ME, [rawTransfer({ hash: hashOf(31), token_id: UNKNOWN_TOKEN_ID })], mainnet)[0]!;
    const explorer = mockExplorer((params) => Effect.succeed(page(params.side === 'to' ? [usd, unknown] : [])));
    const localUsd = entry({ hash: hashOf(32), tokenName: 'fastUSD', tokenId: FASTUSD_ID, network: 'mainnet' });

    for (const token of ['USDC', 'fastusd', FASTUSD_ID.slice(2)]) {
      const { hashes } = await runHistory({ token }, { network: mainnet, networkName: 'mainnet', explorer, entries: [localUsd] });
      expect(hashes).toEqual([hashOf(30), hashOf(32)]);
    }
    const { result } = await runHistory({ token: UNKNOWN_TOKEN_ID }, { network: mainnet, networkName: 'mainnet', explorer, entries: [localUsd] });
    expect(result.transactions).toEqual([expect.objectContaining({ hash: hashOf(31), tokenName: UNKNOWN_TOKEN_ID, formatted: '100000' })]);
  });

  it('still confirms pending bridge entries against the AllSet portal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'success', data: [{ transferFastTxId: hashOf(11).slice(2) }] }))),
    );

    const { result, statusUpdates } = await runHistory({ direction: 'out' });

    expect(statusUpdates).toEqual([[hashOf(11), 'confirmed']]);
    expect(result.transactions.find((t) => t.hash === hashOf(11))).toMatchObject({ status: 'confirmed', source: 'local' });
  });

  it('prints direction and source in the human table', async () => {
    const { tables } = await runHistory({ direction: 'in' });

    expect(tables[0]![0]).toEqual([
      `${hashOf(1).slice(0, 10)}...`,
      'Fast → Fast transfer',
      'in',
      `${LEO.slice(0, 10)}...`,
      `${ME.slice(0, 10)}...`,
      '0.1',
      'testUSDC',
      'confirmed',
      '2026-10-02T03:00:00.123Z',
      'network',
    ]);
  });
});

describe('info history paging', () => {
  const manyLocal = (n: number, overrides: Partial<HistoryEntry> = {}) =>
    Array.from({ length: n }, (_, i) =>
      entry({ hash: hashOf(10_000 + i), timestamp: new Date(Date.parse('2026-10-01T00:00:00Z') - i * 1000).toISOString(), ...overrides }),
    );

  it('reads the local log in batches and stops once the page is covered', async () => {
    const entries = manyLocal(1000);

    const { hashes, listCalls } = await runHistory({}, { entries, explorer: mockExplorer(() => Effect.succeed(page([]))) });

    expect(listCalls).toEqual([{ limit: 200, offset: 0 }]);
    expect(hashes).toHaveLength(20);
    expect(hashes[0]).toBe(hashOf(10_000));
  });

  it('keeps reading batches while the filters drop entries, and stops at the end of the log', async () => {
    // 450 entries from another account (not shown for this account), then 5 of ours.
    const entries = [
      ...manyLocal(450, { from: OTHER, to: LEO }),
      ...manyLocal(5).map((e, i) => ({ ...e, hash: hashOf(20_000 + i), timestamp: `2026-09-0${i + 1}T00:00:00.000Z` })),
    ];

    const { listCalls, result } = await runHistory({}, { entries, explorer: mockExplorer(() => Effect.succeed(page([]))) });

    expect(listCalls).toEqual([
      { limit: 200, offset: 0 },
      { limit: 200, offset: 200 },
      { limit: 200, offset: 400 },
    ]);
    expect(result.transactions.filter((t) => t.source === 'local')).toHaveLength(5);
  });

  it('pages the explorer deep enough for a large --offset', async () => {
    const pages = 15;
    const explorer = mockExplorer((params) => {
      if (params.side === 'from') return Effect.succeed(page([]));
      const n = params.cursor === null ? 0 : Number(params.cursor);
      const rows = Array.from({ length: 100 }, (_, i) => {
        const k = n * 100 + i;
        return transfersFor(ME, [
          rawTransfer({ hash: hashOf(50_000 + k), submission_timestamp: new Date(Date.parse('2026-10-02T00:00:00Z') - k * 1000).toISOString() }),
        ])[0]!;
      });
      return Effect.succeed(page(rows, n + 1 < pages ? { hasMore: true, nextCursor: String(n + 1) } : {}));
    });

    const { hashes, warnings } = await runHistory({ offset: 1000, limit: 100, direction: 'in' }, { entries: [], explorer });

    expect(hashes).toHaveLength(100);
    expect(hashes[0]).toBe(hashOf(51_000));
    expect(warnings).toEqual([]);
  });

  it('counts rows after de-duplication, so a locally recorded transaction does not end the feed early', async () => {
    const at = (n: number, iso: string, op = 0) => transfersFor(ME, [rawTransfer({ hash: hashOf(n), op_index: op, submission_timestamp: iso })])[0]!;
    // One local entry for a transaction with two value operations: the explorer
    // returns both operations on the first page, the local log has one row.
    const twin = entry({ hash: hashOf(71), from: LEO, to: ME, timestamp: '2026-10-02T05:00:00.000Z' });
    const explorer = mockExplorer((params) => {
      if (params.side === 'from') return Effect.succeed(page([]));
      return params.cursor === null
        ? Effect.succeed(page([at(71, '2026-10-02T05:00:00Z', 0), at(71, '2026-10-02T05:00:00Z', 1)], { hasMore: true, nextCursor: 'p2' }))
        : Effect.succeed(page([at(73, '2026-10-02T04:58:00Z'), at(74, '2026-10-02T04:57:00Z')]));
    });

    const { hashes, calls } = await runHistory({ direction: 'in', limit: 2 }, { entries: [twin], explorer });

    expect(hashes).toEqual([hashOf(71), hashOf(73)]);
    expect(calls.filter((c) => c.side === 'to').map((c) => c.cursor)).toEqual([null, 'p2']);
  });

  it('orders rows from the two feeds by exact time, even within one millisecond', async () => {
    // Same millisecond: the outgoing row is 0.6 ms older than the incoming one.
    const outRow = transfersFor(ME, [
      rawTransfer({ hash: hashOf(91), from: ME, to: OTHER, submission_timestamp: '2026-10-02T07:00:00.000300Z' }),
    ])[0]!;
    const inRow = transfersFor(ME, [rawTransfer({ hash: hashOf(92), submission_timestamp: '2026-10-02T07:00:00.000900Z' })])[0]!;
    const explorer = mockExplorer((params) => Effect.succeed(page(params.side === 'from' ? [outRow] : [inRow])));

    const all = await runHistory({}, { entries: [], explorer });
    const first = await runHistory({ limit: 1 }, { entries: [], explorer });

    expect(all.hashes).toEqual([hashOf(92), hashOf(91)]);
    expect(first.hashes).toEqual([hashOf(92)]);
  });

  it('takes a self transfer from the incoming feed only, so the outgoing feed keeps paging for real rows', async () => {
    const self = (n: number, iso: string) => transfersFor(ME, [rawTransfer({ hash: hashOf(n), from: ME, to: ME, submission_timestamp: iso })])[0]!;
    const out = (n: number, iso: string) => transfersFor(ME, [rawTransfer({ hash: hashOf(n), from: ME, to: OTHER, submission_timestamp: iso })])[0]!;
    const explorer = mockExplorer((params) => {
      if (params.side === 'to') return Effect.succeed(page([self(81, '2026-10-02T06:00:00Z'), self(82, '2026-10-02T05:59:00Z')]));
      return params.cursor === null
        ? Effect.succeed(page([self(81, '2026-10-02T06:00:00Z'), self(82, '2026-10-02T05:59:00Z')], { hasMore: true, nextCursor: 'p2' }))
        : Effect.succeed(page([out(83, '2026-10-02T05:58:00Z'), out(84, '2026-10-02T05:57:00Z')]));
    });

    const { hashes, calls } = await runHistory({ limit: 4 }, { entries: [], explorer });

    expect(hashes).toEqual([hashOf(81), hashOf(82), hashOf(83), hashOf(84)]);
    expect(calls.filter((c) => c.side === 'from').map((c) => c.cursor)).toEqual([null, 'p2']);
  });

  it('takes same-address Burns from one feed before counting default history pages', async () => {
    const burn = (n: number, iso: string) =>
      transfersFor(ME, [rawTransfer({ hash: hashOf(n), type: 'Burn', from: ME, to: ME, submission_timestamp: iso })])[0]!;
    const out = (n: number, iso: string) => transfersFor(ME, [rawTransfer({ hash: hashOf(n), from: ME, to: OTHER, submission_timestamp: iso })])[0]!;
    const burns = [burn(85, '2026-10-02T06:00:00Z'), burn(86, '2026-10-02T05:59:00Z')];
    const explorer = mockExplorer((params) => {
      if (params.side === 'to') return Effect.succeed(page(burns));
      return params.cursor === null
        ? Effect.succeed(page(burns, { hasMore: true, nextCursor: 'p2' }))
        : Effect.succeed(page([out(87, '2026-10-02T05:58:00Z'), out(88, '2026-10-02T05:57:00Z')]));
    });

    const { hashes, result, calls } = await runHistory({ limit: 2 }, { entries: [], explorer });

    expect(hashes).toEqual([hashOf(85), hashOf(86)]);
    expect(result.transactions.map((t) => t.direction)).toEqual(['out', 'out']);
    expect(calls.filter((c) => c.side === 'from').map((c) => c.cursor)).toEqual([null, 'p2']);
  });

  it('stops paging a filter that matches nothing after a bounded number of pages, and says so', async () => {
    const explorer = mockExplorer((params, call) =>
      Effect.succeed(
        page(
          params.side === 'to'
            ? [transfersFor(ME, [rawTransfer({ hash: hashOf(60_000 + call), submission_timestamp: '2026-10-02T00:00:00Z' })])[0]!]
            : [],
          params.side === 'to' ? { hasMore: true, nextCursor: `c${call}` } : {},
        ),
      ),
    );

    const { result, calls } = await runHistory({ token: UNKNOWN_TOKEN_ID, direction: 'in' }, { entries: [], explorer });

    // limit 20 → page size 50 → 1 page for the rows plus 20 extra.
    expect(calls.filter((c) => c.side === 'to')).toHaveLength(21);
    expect(result.warnings[0]).toContain('cut off after 21 pages');
  });
});

describe('info history --local', () => {
  it('classifies an EVM deposit to another local account as outgoing for its recording account', async () => {
    const outboundDeposit = entry({
      hash: hashOf(94),
      from: MY_EVM,
      to: OTHER,
      route: 'evm-to-fast',
    });
    const opts = { entries: [outboundDeposit, localDeposit], accounts: [account, recipientAccount] };

    const incomingOnly = await runHistory({ local: true, direction: 'in' }, opts);
    const outgoingOnly = await runHistory({ local: true, direction: 'out' }, opts);

    expect(incomingOnly.hashes).toEqual([localDeposit.hash]);
    expect(outgoingOnly.hashes).toEqual([outboundDeposit.hash]);
    expect(outgoingOnly.result.transactions[0]).toMatchObject({ from: MY_EVM, to: OTHER, direction: 'out', source: 'local' });
    expect(incomingOnly.calls).toHaveLength(0);
    expect(outgoingOnly.calls).toHaveLength(0);
  });

  it('keeps an account-bound local log available without a matching active network', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([incoming])));

    const { hashes, calls } = await runHistory({ local: true }, { account: mainnetMultisig, accountName: 'treasury', explorer });

    expect(hashes).toContain(hashOf(10));
    expect(calls).toHaveLength(0);
  });

  it('lists the whole local log for every local account, without the network or an account lookup', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([incoming])));

    const { result, hashes, calls, accountLookups, warnings } = await runHistory({ local: true }, { explorer });

    expect(calls).toHaveLength(0);
    expect(accountLookups).toHaveLength(0);
    expect(hashes).toEqual([hashOf(11), hashOf(10), hashOf(12), `0x${'cd'.repeat(32)}`]);
    expect(result.transactions.every((t) => t.source === 'local')).toBe(true);
    expect(result.transactions.map((t) => t.direction)).toEqual(['out', 'out', 'out', 'in']);
    expect(result.account).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('still applies --direction and the other filters to the local log', async () => {
    const incomingOnly = await runHistory({ local: true, direction: 'in' }, { explorer: mockExplorer(() => Effect.succeed(page([]))) });
    const toLeo = await runHistory({ local: true, to: LEO }, { explorer: mockExplorer(() => Effect.succeed(page([]))) });

    expect(incomingOnly.hashes).toEqual([`0x${'cd'.repeat(32)}`]);
    expect(toLeo.hashes).toEqual(expect.arrayContaining([hashOf(12)]));
    expect(toLeo.result.transactions.every((t) => String(t.to).toLowerCase() === LEO.toLowerCase())).toBe(true);
  });

  it('with --account, narrows the local log to that account and still skips the network', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([incoming])));

    const { result, hashes, calls, accountLookups } = await runHistory({ local: true }, { explorer, accountName: 'agent' });

    expect(calls).toHaveLength(0);
    expect(accountLookups).toEqual([Option.some('agent')]);
    expect(hashes).not.toContain(hashOf(12));
    expect(result.account).toBe(ME);
    expect(result.warnings).toEqual([]);
  });
});

describe('info history human labels', () => {
  it('uses token operation types instead of the Fast transfer route label', async () => {
    const entries = (['token-create', 'token-mint', 'token-burn', 'token-manage', 'transfer'] as const).map((type) =>
      entry({ hash: `0x${type}`, type, timestamp: '2026-09-16T00:00:00.000Z' }),
    );
    const explorer = mockExplorer(() => Effect.succeed(page([])));

    const { tables } = await runHistory({}, { entries, explorer });

    expect(tables[0]!.map((row) => row[1])).toEqual(['token-create', 'token-mint', 'token-burn', 'token-manage', 'Fast → Fast transfer']);
  });
});
