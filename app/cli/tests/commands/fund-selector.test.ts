import { toFastAddress } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { fundSelector } from '../../src/commands/fund/select.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore } from '../../src/services/storage/account.js';

const address = toFastAddress(new Uint8Array(32).fill(1));

const makeLayer = ({
  answer = '1',
  nonInteractive = false,
  json = false,
}: {
  answer?: string;
  nonInteractive?: boolean;
  json?: boolean;
} = {}) => {
  const lines: string[] = [];
  const results: unknown[] = [];
  const input = vi.fn(() => Effect.succeed(answer));
  const layer = Layer.mergeAll(
    Layer.succeed(AccountStore, { resolveAccount: () => Effect.die('address should be supplied') } as never),
    Layer.succeed(ClientConfig, {
      json,
      debug: false,
      nonInteractive,
      network: 'mainnet',
      account: Option.none(),
      password: Option.none(),
    }),
    Layer.succeed(Output, {
      humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
      ok: (value: unknown) => Effect.sync(() => void results.push(value)),
      fail: () => Effect.void,
      humanTable: () => Effect.void,
      debug: () => Effect.void,
    }),
    Layer.succeed(Prompt, {
      input,
      password: () => Effect.die('unexpected password prompt'),
      confirm: () => Effect.die('unexpected confirmation prompt'),
    } as never),
  );
  return { layer, lines, results, input };
};

describe('fast fund selector', () => {
  it('shows the four supported methods and prints the selected deep link', async () => {
    const state = makeLayer({ answer: '4' });
    await Effect.runPromise(fundSelector.handler({ address } as never).pipe(Effect.provide(state.layer)));

    expect(state.lines.join('\n')).toContain('1. Card');
    expect(state.lines.join('\n')).toContain('2. USDC from another network');
    expect(state.lines.join('\n')).toContain('3. Coinbase');
    expect(state.lines.join('\n')).toContain('4. Swapper');
    expect(state.results).toEqual([
      {
        url: `https://app.fast.xyz/crypto?supplier=swapper&to=${address}`,
        address,
        asset: 'fastUSD',
      },
    ]);
  });

  it('does not prompt in non-interactive mode', async () => {
    const state = makeLayer({ nonInteractive: true });
    const exit = await Effect.runPromiseExit(fundSelector.handler({ address } as never).pipe(Effect.provide(state.layer)));

    expect(exit._tag).toBe('Failure');
    expect(state.input).not.toHaveBeenCalled();
  });

  it('requires an explicit method in JSON mode', async () => {
    const state = makeLayer({ json: true });
    const exit = await Effect.runPromiseExit(fundSelector.handler({ address } as never).pipe(Effect.provide(state.layer)));

    expect(exit._tag).toBe('Failure');
    expect(state.input).not.toHaveBeenCalled();
  });
});
