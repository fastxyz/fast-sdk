import { Signer } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { infoBalance } from '../../src/commands/info/balance.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { FastSdkError } from '../../src/errors/index.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const tokenA = new Uint8Array(32).fill(0x11);
const tokenB = new Uint8Array(32).fill(0x22);

const runBalanceScenario = async (metadataFailure: boolean) => {
  const fastAddress = await new Signer(new Uint8Array(32).fill(1)).getFastAddress();
  const account: AccountInfo = {
    kind: 'multisig',
    name: 'treasury',
    fastAddress,
    multisigConfig: {
      version: 1,
      name: 'treasury',
      signers: [fastAddress, fastAddress],
      quorum: 2,
      configNonce: '0',
      fastAddress,
      network: 'testnet',
    },
    isDefault: true,
    createdAt: new Date(0).toISOString(),
  };
  let metadataCalls = 0;
  let requestedTokenIds: readonly Uint8Array[] = [];
  let result: { balances?: Array<{ token: string; networks: Array<{ network: string; balance: string }> }> } = {};

  const layer = Layer.mergeAll(
    Layer.succeed(AccountStore, { resolveAccount: () => Effect.succeed(account) } as never),
    Layer.succeed(ClientConfig, {
      json: true,
      debug: false,
      nonInteractive: true,
      network: 'testnet',
      account: Option.none(),
      password: Option.none(),
    }),
    Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(bundledNetworks.testnet!) } as never),
    Layer.succeed(Output, {
      humanLine: () => Effect.void,
      humanTable: () => Effect.void,
      ok: (value: typeof result) => Effect.sync(() => void (result = value)),
      fail: () => Effect.void,
      debug: () => Effect.void,
    } as never),
    Layer.succeed(FastRpc, {
      getAccountInfo: () =>
        Effect.succeed({
          tokenBalance: [
            [tokenA, 1_250_000n],
            [tokenB, 42n],
          ],
        }),
      getTokenInfo: (params: { tokenIds: readonly Uint8Array[] }) => {
        metadataCalls++;
        requestedTokenIds = params.tokenIds;
        return metadataFailure
          ? Effect.fail(new FastSdkError({ message: 'metadata unavailable' }))
          : Effect.succeed({
              requestedTokenMetadata: [
                [tokenB, { tokenName: 'TOKEN_B', decimals: 0 }],
                [tokenA, { tokenName: 'TOKEN_A', decimals: 6 }],
              ],
            });
      },
    } as never),
  );

  await Effect.runPromise(infoBalance.handler({} as never).pipe(Effect.provide(layer)));
  return { metadataCalls, requestedTokenIds, result };
};

describe('info balance metadata', () => {
  it('fetches all unconfigured token metadata in one request and maps by token id', async () => {
    const { metadataCalls, requestedTokenIds, result } = await runBalanceScenario(false);

    expect(metadataCalls).toBe(1);
    expect(requestedTokenIds).toHaveLength(2);
    expect(result.balances).toEqual(
      expect.arrayContaining([
        { token: 'TOKEN_A', networks: [{ network: 'Fast', balance: '1.25' }] },
        { token: 'TOKEN_B', networks: [{ network: 'Fast', balance: '42' }] },
      ]),
    );
  });

  it('preserves raw Fast balances when metadata is unavailable', async () => {
    const { metadataCalls, result } = await runBalanceScenario(true);

    expect(metadataCalls).toBe(1);
    expect(result.balances).toEqual(
      expect.arrayContaining([
        { token: '0x111111111111…', networks: [{ network: 'Fast', balance: '1250000' }] },
        { token: '0x222222222222…', networks: [{ network: 'Fast', balance: '42' }] },
      ]),
    );
  });
});
