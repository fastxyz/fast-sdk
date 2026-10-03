import { fromHex } from '@fastxyz/sdk';
import { Duration, Effect, Exit, Fiber, Layer, Option, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';
import { waitForPayment } from '../../src/commands/wait-for-payment.js';
import {
  ExplorerNotConfiguredError,
  InvalidAddressError,
  InvalidAmountError,
  InvalidUsageError,
  PaymentTimeoutError,
  TokenNotFoundError,
} from '../../src/errors/index.js';
import type { NetworkConfig } from '../../src/schemas/networks.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { type AccountInfo, AccountStore } from '../../src/services/storage/account.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import {
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

const account: AccountInfo = {
  kind: 'single',
  name: 'agent',
  fastAddress: ME,
  evmAddress: `0x${'ee'.repeat(20)}`,
  isDefault: true,
  encrypted: false,
  createdAt: new Date(0).toISOString(),
};

const at = (n: number, iso: string, overrides: Record<string, unknown> = {}, network: NetworkConfig = testnet, address = ME) =>
  transfersFor(address, [rawTransfer({ hash: hashOf(n), to: address, submission_timestamp: iso, ...overrides })], network)[0]!;

const run = async (
  args: Record<string, unknown>,
  opts: {
    explorer?: ReturnType<typeof mockExplorer>;
    network?: NetworkConfig;
    networkName?: string;
    /** Advance the TestClock by this much after starting the command. */
    advance?: Duration.DurationInput;
  } = {},
) => {
  const lines: string[] = [];
  const results: unknown[] = [];
  let accountLookups = 0;
  const explorer = opts.explorer ?? mockExplorer(() => Effect.succeed(page([])));
  const layer = Layer.mergeAll(
    explorer.layer,
    Layer.succeed(AccountStore, { resolveAccount: () => Effect.sync(() => (accountLookups++, account)) } as never),
    Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(opts.network ?? testnet) } as never),
    Layer.succeed(ClientConfig, {
      json: false,
      debug: false,
      nonInteractive: true,
      network: opts.networkName ?? 'testnet',
      account: Option.none(),
      password: Option.none(),
    }),
    Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.succeed({ requestedTokenMetadata: [[fromHex(UNKNOWN_TOKEN_ID), { tokenName: 'GOLD', decimals: 2 }]] }),
    } as never),
    Layer.succeed(Output, {
      humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
      ok: (data: unknown) => Effect.sync(() => void results.push(data)),
      humanTable: () => Effect.void,
      warn: () => Effect.void,
      fail: () => Effect.void,
      debug: () => Effect.void,
    } as never),
  );
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(waitForPayment.handler({ timeout: 300, ...args } as never).pipe(Effect.provide(layer)));
      if (opts.advance !== undefined) yield* TestClock.adjust(opts.advance);
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  return { exit, lines, results, calls: explorer.calls, accountLookups: () => accountLookups };
};

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit) || exit.cause._tag !== 'Fail') throw new Error(`expected a failure, got ${String(exit)}`);
  return exit.cause.error as Error & { errorCode: string };
};

describe('fast wait-for-payment', () => {
  it('honours a --since with microseconds: an earlier payment in the same millisecond does not count', async () => {
    const explorer = mockExplorer((_params, call) =>
      Effect.succeed(
        page(call === 0 ? [at(1, '2026-10-02T03:00:00.000500Z')] : [at(2, '2026-10-02T03:00:00.000950Z'), at(1, '2026-10-02T03:00:00.000500Z')]),
      ),
    );

    const { exit, results } = await run({ amount: '0.1', since: '2026-10-02T03:00:00.000900Z' }, { explorer, advance: Duration.seconds(2) });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(results).toEqual([expect.objectContaining({ hash: hashOf(2) })]);
  });

  it("waits for the exact amount of the network's default token to the active account", async () => {
    const explorer = mockExplorer((_params, call) =>
      Effect.succeed(page(call === 0 ? [at(1, '2026-10-02T03:00:00Z', { amount: '186a1' })] : [at(2, '2026-10-02T03:00:02.5Z')])),
    );

    const { exit, results, lines, calls } = await run({ amount: '0.1' }, { explorer, advance: Duration.seconds(2) });

    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(results).toEqual([
      {
        hash: hashOf(2),
        type: 'transfer',
        from: LEO,
        to: ME,
        amount: '100000',
        formatted: '0.1',
        tokenName: 'testUSDC',
        tokenId: TESTUSDC_ID,
        timestamp: '2026-10-02T03:00:02.500Z',
        explorerUrl: `https://testnet.explorer.fast.xyz/txs/${hashOf(2)}`,
        network: 'testnet',
      },
    ]);
    // Poll 1 (full) finds nothing; poll 2 finds it and re-reads the window to confirm it is the earliest.
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ address: ME, side: 'to', order: 'desc' });
    expect(lines[0]).toBe(`Waiting up to 300s for 0.1 testUSDC to ${ME} since 1970-01-01T00:00:00.000Z...`);
    expect(lines).toContain(`Payment received: 0.1 testUSDC from ${LEO}`);
  });

  it('accepts a bridge deposit (Mint) as the payment', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([at(3, '2026-10-02T03:00:00Z', { type: 'Mint', amount: 'f4240' })])));

    const { exit, results } = await run({ amount: '1' }, { explorer });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(results[0]).toMatchObject({ hash: hashOf(3), type: 'token-mint', formatted: '1' });
  });

  it('only accepts payments at or after --since and from --from', async () => {
    const explorer = mockExplorer(() =>
      Effect.succeed(
        page([
          at(4, '2026-10-02T03:00:30Z', { from: OTHER }),
          at(5, '2026-10-02T03:00:20Z'),
          at(6, '2026-10-02T02:59:00Z'), // before --since
        ]),
      ),
    );

    const { exit, results } = await run({ amount: '0.1', from: LEO, since: '2026-10-02T03:00:00Z' }, { explorer });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(results[0]).toMatchObject({ hash: hashOf(5), from: LEO });
  });

  it('--to watches another address without needing an account', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([at(7, '2026-10-02T03:00:00Z', {}, testnet, OTHER)])));

    const { exit, results, calls, accountLookups } = await run({ amount: '0.1', to: OTHER.toUpperCase() }, { explorer });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(calls[0]!.address).toBe(OTHER);
    expect(results[0]).toMatchObject({ to: OTHER });
    expect(accountLookups()).toBe(0);
  });

  it('resolves --token symbols on the network (USDC → the fastUSD id on mainnet)', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([at(8, '2026-10-02T03:00:00Z', { token_id: FASTUSD_ID, amount: '2625a0' }, mainnet)])));

    const { exit, results } = await run({ amount: '2.5', token: 'USDC' }, { explorer, network: mainnet, networkName: 'mainnet' });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(results[0]).toMatchObject({ tokenName: 'USDC', tokenId: FASTUSD_ID, amount: '2500000', formatted: '2.5' });
  });

  it('reads decimals on-chain for a token id the network config does not know', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([at(9, '2026-10-02T03:00:00Z', { token_id: UNKNOWN_TOKEN_ID, amount: '7d' })])));

    const { exit, results } = await run({ amount: '1.25', token: UNKNOWN_TOKEN_ID }, { explorer });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(results[0]).toMatchObject({ tokenName: 'GOLD', tokenId: UNKNOWN_TOKEN_ID, amount: '125', formatted: '1.25' });
  });

  it('fails with PAYMENT_TIMEOUT when nothing matching arrives in time', async () => {
    const explorer = mockExplorer(() => Effect.succeed(page([at(1, '2026-10-02T03:00:00Z', { amount: '1' })])));

    const { exit, results } = await run({ amount: '0.1', timeout: 5 }, { explorer, advance: Duration.seconds(5) });

    const error = failure(exit);
    expect(error).toBeInstanceOf(PaymentTimeoutError);
    expect(error.errorCode).toBe('PAYMENT_TIMEOUT');
    expect(error.message).toBe(`No matching payment arrived within 5s (expected 0.1 testUSDC to ${ME} since 1970-01-01T00:00:00.000Z).`);
    expect(results).toEqual([]);
  });

  it('fails with EXPLORER_NOT_CONFIGURED on a network without an explorer API', async () => {
    const { explorerApiUrl: _, ...custom } = testnet;

    const { exit, calls } = await run({ amount: '1' }, { network: custom, networkName: 'devnet' });

    expect(failure(exit)).toBeInstanceOf(ExplorerNotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ amount: '0.1234567' }, InvalidAmountError, 'Amount has too many decimal places for testUSDC (max 6)'],
    [{ amount: '0' }, InvalidAmountError, 'Amount must be greater than zero (got "0").'],
    [{ amount: 'ten' }, InvalidAmountError, 'Invalid amount "ten". Expected a positive number (e.g., 10 or 1.5).'],
    [{ amount: '1', from: 'fast1nope' }, InvalidAddressError, '--from "fast1nope" is not a valid fast1... address.'],
    [{ amount: '1', to: '0x1234' }, InvalidAddressError, '--to "0x1234" is not a valid fast1... address.'],
    [
      { amount: '1', since: 'yesterday' },
      InvalidUsageError,
      '--since "yesterday" is not a valid ISO 8601 time (e.g. 2026-10-02T12:00:00Z; impossible dates such as 2026-02-30 are rejected).',
    ],
    [
      { amount: '1', since: '2026-02-30' },
      InvalidUsageError,
      '--since "2026-02-30" is not a valid ISO 8601 time (e.g. 2026-10-02T12:00:00Z; impossible dates such as 2026-02-30 are rejected).',
    ],
    [{ amount: '1', timeout: 0 }, InvalidUsageError, '--timeout must be a whole number of seconds from 1 to 2147483'],
    // One second past what the runtime timers support: Effect would never fire the timeout.
    [{ amount: '1', timeout: 2_147_484 }, InvalidUsageError, '--timeout must be a whole number of seconds from 1 to 2147483'],
    [{ amount: '1', token: 'NOPE' }, TokenNotFoundError, 'Unknown token "NOPE"'],
  ])('rejects bad input %j before polling', async (args, errorClass, message) => {
    const { exit, calls } = await run(args);

    const error = failure(exit);
    expect(error).toBeInstanceOf(errorClass);
    expect(error.message).toContain(message);
    expect(calls).toHaveLength(0);
  });
});
