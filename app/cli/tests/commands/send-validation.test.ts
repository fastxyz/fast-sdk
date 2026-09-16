import { Signer } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { send } from '../../src/commands/send.js';
import { testnetCfg } from '../fixtures/networks.js';
import { InvalidAddressError } from '../../src/errors/index.js';
import { AllSet } from '../../src/services/api/allset.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

describe('send recipient validation', () => {
  it('maps a malformed fast-prefixed recipient to InvalidAddressError', async () => {
    const seed = new Uint8Array(32).fill(1);
    const signer = new Signer(seed);
    const account: AccountInfo = {
      kind: 'single',
      name: 'alice',
      fastAddress: await signer.getFastAddress(),
      evmAddress: '0x0000000000000000000000000000000000000000',
      isDefault: true,
      encrypted: false,
      createdAt: new Date(0).toISOString(),
    };
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, {
        resolveAccount: () => Effect.succeed(account),
        export: () => Effect.succeed({ seed, account }),
        list: () => Effect.succeed([account]),
      } as never),
      Layer.succeed(AllSet, {} as never),
      Layer.succeed(ClientConfig, {
        json: true,
        debug: false,
        nonInteractive: true,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(Output, {
        humanLine: () => Effect.void,
        humanTable: () => Effect.void,
        ok: () => Effect.void,
        fail: () => Effect.void,
        debug: () => Effect.void,
      } as never),
      Layer.succeed(Prompt, {
        password: () => Effect.die('password prompt must not run'),
        input: () => Effect.die('input prompt must not run'),
        confirm: () => Effect.die('confirmation must not run'),
      } as never),
      Layer.succeed(HistoryStore, { record: () => Effect.void } as never),
      Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(testnetCfg) } as never),
    );

    const exit = await Effect.runPromiseExit(
      send
        .handler({ address: 'fast1bad', amount: '1', token: 'testUSDC', replacePending: false } as never)
        .pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(InvalidAddressError);
  });
});
