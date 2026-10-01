import { Signer } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { send } from '../../src/commands/send.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { FastIdResolutionError, InvalidAddressError, InvalidUsageError } from '../../src/errors/index.js';
import { AllSet } from '../../src/services/api/allset.js';
import { asFastIdName, FastIdResolver, type FastIdNetwork } from '../../src/services/api/fast-id.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const seed = (value: number) => new Uint8Array(32).fill(value);

interface Harness {
  resolveCalls: Array<{ name: string; network: FastIdNetwork }>;
  submissions: number;
  accountLookups: number;
  lines: string[];
  results: unknown[];
  confirmPrompts: string[];
  recorded: Array<{ to: string }>;
}

async function setup(opts: {
  resolve?: (name: string, network: FastIdNetwork) => Effect.Effect<{ name: string; address: string }, unknown>;
  network?: 'testnet' | 'mainnet' | 'custom';
  interactive?: boolean;
}) {
  const senderSeed = seed(1);
  const sender = new Signer(senderSeed);
  const recipient = await new Signer(seed(2)).getFastAddress();
  const account: AccountInfo = {
    kind: 'single',
    name: 'agent',
    fastAddress: await sender.getFastAddress(),
    evmAddress: '0x0000000000000000000000000000000000000000',
    isDefault: true,
    encrypted: false,
    createdAt: new Date(0).toISOString(),
  };
  const h: Harness = {
    resolveCalls: [],
    submissions: 0,
    accountLookups: 0,
    lines: [],
    results: [],
    confirmPrompts: [],
    recorded: [],
  };
  const networkCfg =
    opts.network === 'custom' ? { ...bundledNetworks.testnet!, networkId: 'fast:devnet' } : bundledNetworks[opts.network ?? 'testnet']!;
  const layer = Layer.mergeAll(
    Layer.succeed(AccountStore, {
      resolveAccount: () => Effect.sync(() => (h.accountLookups++, account)),
      export: () => Effect.succeed({ seed: senderSeed, account }),
      list: () => Effect.succeed([account]),
    } as never),
    Layer.succeed(AllSet, {} as never),
    Layer.succeed(ClientConfig, {
      json: false,
      debug: false,
      nonInteractive: !opts.interactive,
      network: opts.network === 'custom' ? 'devnet' : (opts.network ?? 'testnet'),
      account: Option.none(),
      password: Option.none(),
    }),
    Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(networkCfg) } as never),
    Layer.succeed(Output, {
      humanLine: (line: string) => Effect.sync(() => void h.lines.push(line)),
      ok: (data: unknown) => Effect.sync(() => void h.results.push(data)),
      fail: () => Effect.void,
      humanTable: () => Effect.void,
      debug: () => Effect.void,
    }),
    Layer.succeed(Prompt, {
      password: () => Effect.die('password prompt must not run'),
      input: () => Effect.die('input prompt must not run'),
      confirm: (q: string) => Effect.sync(() => (h.confirmPrompts.push(q), true)),
    } as never),
    Layer.succeed(HistoryStore, {
      record: (entry: { to: string }) => Effect.sync(() => void h.recorded.push(entry)),
    } as never),
    Layer.succeed(FastRpc, {
      getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
      submitTransaction: (envelope: unknown) =>
        Effect.sync(() => {
          h.submissions++;
          return { type: 'Success', value: { envelope } };
        }),
    } as never),
    Layer.succeed(FastIdResolver, {
      resolve: (name: string, network: FastIdNetwork) => {
        h.resolveCalls.push({ name, network });
        return opts.resolve ? opts.resolve(name, network) : Effect.succeed({ name, address: recipient });
      },
    } as never),
  );
  const run = (args: Record<string, unknown>) =>
    Effect.runPromiseExit(send.handler({ amount: '1', token: 'testUSDC', replacePending: false, ...args } as never).pipe(Effect.provide(layer)));
  return { h, run, recipient, account };
}

const failureOf = (exit: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['run']>>) => {
  if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected a typed failure');
  return exit.cause.error;
};

describe('asFastIdName', () => {
  it('normalizes case and whitespace, and rejects non-name input', () => {
    expect(asFastIdName('ana.smith')).toBe('ana.smith');
    expect(asFastIdName('  Ana.Smith ')).toBe('ana.smith');
    expect(asFastIdName('ana')).toBeUndefined();
    expect(asFastIdName('ana.b.c')).toBeUndefined();
    expect(asFastIdName('api.smith')).toBeUndefined();
  });
});

describe('send to a Fast ID name', () => {
  it('resolves the name on the current network and sends to the bound address', async () => {
    const { h, run, recipient } = await setup({});

    const exit = await run({ address: 'Ana.Smith' });

    expect(exit._tag).toBe('Success');
    expect(h.resolveCalls).toEqual([{ name: 'ana.smith', network: 'fast:testnet' }]);
    expect(h.submissions).toBe(1);
    expect(h.recorded).toEqual([expect.objectContaining({ to: recipient })]);
    expect(h.lines.join('\n')).toContain(`Sent 1 testUSDC to ana.smith (${recipient})`);
    expect(h.results).toEqual([expect.objectContaining({ to: recipient, toName: 'ana.smith', route: 'fast' })]);
  });

  it('uses the mainnet registry on mainnet', async () => {
    const { h, run } = await setup({ network: 'mainnet' });

    await run({ address: 'ana.smith', token: undefined });

    expect(h.resolveCalls).toEqual([{ name: 'ana.smith', network: 'fast:mainnet' }]);
  });

  it('shows the name and the resolved address in the interactive confirmation', async () => {
    const { h, run, recipient } = await setup({ interactive: true });

    await run({ address: 'ana.smith' });

    expect(h.confirmPrompts).toHaveLength(1);
    expect(h.lines).toContain(`  To:    ana.smith (${recipient})`);
  });

  it('keeps plain fast1 recipients off the resolver and without toName', async () => {
    const { h, run, recipient } = await setup({});

    const exit = await run({ address: recipient });

    expect(exit._tag).toBe('Success');
    expect(h.resolveCalls).toEqual([]);
    expect(h.results).toEqual([expect.not.objectContaining({ toName: expect.anything() })]);
  });

  it('fails closed on an unregistered name before touching the account', async () => {
    const { h, run } = await setup({
      resolve: (name) => Effect.fail(new InvalidAddressError({ message: `Fast ID "${name}" is not registered` })),
    });

    const exit = await run({ address: 'nobody.here' });

    expect(failureOf(exit)).toBeInstanceOf(InvalidAddressError);
    expect(h.accountLookups).toBe(0);
    expect(h.submissions).toBe(0);
  });

  it('fails closed when the registry cannot be read', async () => {
    const { h, run } = await setup({
      resolve: (name) => Effect.fail(new FastIdResolutionError({ fastId: name, reason: 'timeout' })),
    });

    const exit = await run({ address: 'ana.smith' });

    const error = failureOf(exit);
    expect(error).toBeInstanceOf(FastIdResolutionError);
    expect((error as FastIdResolutionError).message).toContain('Nothing was sent');
    expect(h.submissions).toBe(0);
  });

  it('rejects a name as a --to-chain recipient without resolving it', async () => {
    const { h, run } = await setup({});

    const exit = await run({ address: 'ana.smith', toChain: 'base', token: 'USDC' });

    expect(failureOf(exit)).toBeInstanceOf(InvalidAddressError);
    expect(h.resolveCalls).toEqual([]);
  });

  it('refuses names on networks without a Fast ID registry', async () => {
    const { h, run } = await setup({ network: 'custom' });

    const exit = await run({ address: 'ana.smith' });

    expect(failureOf(exit)).toBeInstanceOf(InvalidUsageError);
    expect(h.resolveCalls).toEqual([]);
  });

  it('explains the accepted formats for input that is neither an address nor a name', async () => {
    const { h, run } = await setup({});

    const exit = await run({ address: 'ana' });

    const error = failureOf(exit);
    expect(error).toBeInstanceOf(InvalidAddressError);
    expect((error as InvalidAddressError).message).toContain('Fast ID name such as alice.smith');
    expect(h.resolveCalls).toEqual([]);
  });
});
