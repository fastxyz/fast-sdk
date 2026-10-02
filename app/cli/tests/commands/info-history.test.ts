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
  } = {},
) => {
  const captured: Captured = { tables: [], results: [], warnings: [], statusUpdates: [] };
  const accountLookups: Array<Option.Option<string>> = [];
  const explorer = opts.explorer ?? defaultFeed;
  const layer = Layer.mergeAll(
    Layer.succeed(HistoryStore, {
      list: () => Effect.succeed(opts.entries ?? localEntries),
      updateStatus: (hash: string, status: string) => Effect.sync(() => void captured.statusUpdates.push([hash, status])),
    } as never),
    Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(opts.network ?? testnet) } as never),
    Layer.succeed(AccountStore, {
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
  return { ...captured, result, hashes: result.transactions.map((t) => t.hash), calls: explorer.calls, accountLookups };
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

describe('info history --local', () => {
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
