import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { fundFastUsd } from '../../src/commands/fund/fastusd.js';
import { fundUsdcFiat } from '../../src/commands/fund/usdc/fiat.js';
import { WalletNetworkMismatchError } from '../../src/errors/index.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';

const multisig: AccountInfo = {
  kind: 'multisig',
  name: 'testnet-wallet',
  fastAddress: 'fast1testnetwallet',
  multisigConfig: {
    version: 1,
    name: 'testnet-wallet',
    signers: ['fast1alice'],
    quorum: 1,
    configNonce: '0',
    fastAddress: 'fast1testnetwallet',
    network: 'testnet',
  },
  isDefault: true,
  createdAt: new Date(0).toISOString(),
};

const layer = Layer.mergeAll(
  Layer.succeed(AccountStore, { resolveAccount: () => Effect.succeed(multisig) } as never),
  Layer.succeed(ClientConfig, {
    json: true,
    debug: false,
    nonInteractive: true,
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
  } as never),
);

describe('funding account network validation', () => {
  it('rejects a testnet multisig account when generating a mainnet fastUSD URL', async () => {
    const exit = await Effect.runPromiseExit(fundFastUsd.handler({} as never).pipe(Effect.provide(layer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(WalletNetworkMismatchError);
  });

  it('rejects a testnet multisig account when generating a mainnet fiat URL', async () => {
    const exit = await Effect.runPromiseExit(fundUsdcFiat.handler({} as never).pipe(Effect.provide(layer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(WalletNetworkMismatchError);
  });
});
