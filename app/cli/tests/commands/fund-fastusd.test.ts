import { toFastAddress } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { fundFastUsd } from '../../src/commands/fund/fastusd.js';
import { buildFundAppUrl } from '../../src/commands/fund/app-link.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore } from '../../src/services/storage/account.js';

describe('buildFundAppUrl', () => {
  it('builds the supported Card route and preserves a prefilled amount', () => {
    expect(buildFundAppUrl('card', 'fast1abc', '10.5')).toBe('https://app.fast.xyz/card?to=fast1abc&amount=10.5');
  });

  it('URL-encodes the destination address', () => {
    expect(buildFundAppUrl('card', 'fast1abc&to=fast1attacker')).toBe('https://app.fast.xyz/card?to=fast1abc%26to%3Dfast1attacker');
  });

  it('keeps fastusd as a deprecated alias for the selector', async () => {
    const address = toFastAddress(new Uint8Array(32).fill(1));
    const lines: string[] = [];
    const results: unknown[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, { resolveAccount: () => Effect.die('unexpected account lookup') } as never),
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: false,
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
        input: () => Effect.succeed('1'),
        password: () => Effect.die('unexpected password prompt'),
        confirm: () => Effect.die('unexpected confirmation prompt'),
      } as never),
    );

    await Effect.runPromise(fundFastUsd.handler({ to: address, amount: '10' } as never).pipe(Effect.provide(layer)));

    expect(lines.join('\n')).toContain('Deprecated: `fast fund fastusd`');
    expect(results).toEqual([
      {
        url: `https://app.fast.xyz/card?to=${address}&amount=10`,
        address,
        asset: 'fastUSD',
      },
    ]);
  });

  it('preserves INVALID_AMOUNT for malformed amounts through the deprecated alias', async () => {
    const address = toFastAddress(new Uint8Array(32).fill(1));
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, { resolveAccount: () => Effect.die('unexpected account lookup') } as never),
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: false,
        network: 'mainnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(Output, {
        humanLine: () => Effect.void,
        ok: () => Effect.void,
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      }),
      Layer.succeed(Prompt, {
        input: () => Effect.succeed('1'),
        password: () => Effect.die('unexpected password prompt'),
        confirm: () => Effect.die('unexpected confirmation prompt'),
      } as never),
    );

    const outcome = await Effect.runPromise(
      Effect.either(fundFastUsd.handler({ to: address, amount: 'not-a-number' } as never)).pipe(Effect.provide(layer)),
    );
    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') expect(outcome.left.errorCode).toBe('INVALID_AMOUNT');
  });
});
