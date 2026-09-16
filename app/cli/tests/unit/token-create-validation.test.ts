import { bech32m } from 'bech32';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { encodeMemo } from '../../src/commands/token/create.js';
import { tokenCreate } from '../../src/commands/token/create.js';
import { InvalidAddressError, InvalidUsageError } from '../../src/errors/index.js';
import { AccountStore } from '../../src/services/storage/account.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { testnetCfg } from '../fixtures/networks.js';

const invalidFastAddress = bech32m.encode('fast', bech32m.toWords(new Uint8Array(31)));

describe('token create validation', () => {
  it('classifies an overlong UTF-8 memo as invalid usage', () => {
    try {
      encodeMemo('x'.repeat(33));
      throw new Error('expected encodeMemo to reject the memo');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidUsageError);
      if (!(error instanceof InvalidUsageError)) throw error;
      expect(error.errorCode).toBe('INVALID_USAGE');
      expect(error.message).toBe('--memo too long: 33 bytes (max 32)');
    }
  });

  it('accepts and zero-pads a memo at the 32-byte limit', () => {
    const encoded = encodeMemo('x'.repeat(32));
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded).toHaveLength(32);
    expect(new TextDecoder().decode(encoded!)).toBe('x'.repeat(32));
  });

  it('rejects a minter whose bech32 payload is not 32 bytes', async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, { resolveAccount: () => Effect.die('must not resolve account') } as never),
      Layer.succeed(ClientConfig, {
        json: true,
        debug: false,
        nonInteractive: true,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(testnetCfg) } as never),
      Layer.succeed(Output, {
        humanLine: () => Effect.void,
        ok: () => Effect.void,
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      } as never),
      Layer.succeed(Prompt, {
        password: () => Effect.die('must not prompt'),
        input: () => Effect.die('must not prompt'),
        confirm: () => Effect.die('must not prompt'),
      } as never),
      Layer.succeed(HistoryStore, { record: () => Effect.void } as never),
      Layer.succeed(FastRpc, {} as never),
    );

    const exit = await Effect.runPromiseExit(
      tokenCreate
        .handler({ name: 'TEST', decimals: 6, initialSupply: '1', minters: invalidFastAddress, replacePending: false } as never)
        .pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(InvalidAddressError);
  });
});
