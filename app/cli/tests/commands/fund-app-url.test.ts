import { toFastAddress } from '@fastxyz/sdk';
import { bech32m } from 'bech32';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { buildFundAppUrl, openFundAppLink } from '../../src/commands/fund/app-link.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { AccountStore } from '../../src/services/storage/account.js';

describe('buildFundAppUrl', () => {
  it.each([
    ['card', 'https://app.fast.xyz/card?to=fast1abc'],
    ['usdc', 'https://app.fast.xyz/usdc?to=fast1abc'],
    ['coinbase', 'https://app.fast.xyz/crypto?supplier=coinbase&to=fast1abc'],
    ['swapper', 'https://app.fast.xyz/crypto?supplier=swapper&to=fast1abc'],
  ] as const)('builds the supported %s funding link', (method, expected) => {
    expect(buildFundAppUrl(method, 'fast1abc')).toBe(expected);
  });

  it('URL-encodes the destination address', () => {
    expect(buildFundAppUrl('card', 'fast1abc&to=fast1attacker')).toBe('https://app.fast.xyz/card?to=fast1abc%26to%3Dfast1attacker');
  });

  const linkLayer = (results: unknown[]) =>
    Layer.mergeAll(
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
        ok: (value: unknown) => Effect.sync(() => void results.push(value)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      }),
    );

  it('rejects whitespace-padded amount instead of sending it to the app', async () => {
    const address = toFastAddress(new Uint8Array(32).fill(1));
    const results: unknown[] = [];
    const layer = linkLayer(results);

    const result = await Effect.runPromise(Effect.either(openFundAppLink('card', { address, amount: ' 10 ' })).pipe(Effect.provide(layer)));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') expect(result.left.errorCode).toBe('INVALID_AMOUNT');
    expect(results).toEqual([]);
  });

  it('rejects a checksummed fast1 address whose payload is not 32 bytes', async () => {
    const results: unknown[] = [];
    for (const length of [20, 33]) {
      const address = bech32m.encode('fast', bech32m.toWords(new Uint8Array(length).fill(1)));
      const result = await Effect.runPromise(Effect.either(openFundAppLink('card', { address })).pipe(Effect.provide(linkLayer(results))));
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') expect(result.left.errorCode).toBe('INVALID_ADDRESS');
    }
    expect(results).toEqual([]);
  });
});
