import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { toFastAddress } from '@fastxyz/sdk';
import { fundUsdcFiat } from '../../src/commands/fund/usdc/fiat.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { AccountStore } from '../../src/services/storage/account.js';

describe('legacy fund usdc fiat alias', () => {
  it('routes to Card and says the Fast-side asset is fastUSD', async () => {
    const address = toFastAddress(new Uint8Array(32).fill(1));
    const lines: string[] = [];
    const results: unknown[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, { resolveAccount: () => Effect.die('unexpected account lookup') } as never),
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: true,
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
    );

    await Effect.runPromise(fundUsdcFiat.handler({ address } as never).pipe(Effect.provide(layer)));

    expect(lines.join('\n')).toContain('Deprecated: `fast fund usdc fiat` now opens the Card flow.');
    expect(results).toEqual([
      {
        url: `https://app.fast.xyz/card?to=${address}`,
        address,
        asset: 'fastUSD',
      },
    ]);
  });
});
