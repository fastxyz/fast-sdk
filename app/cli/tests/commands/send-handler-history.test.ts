import { Signer } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { send } from '../../src/commands/send.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { DatabaseError } from '../../src/errors/index.js';
import { AllSet } from '../../src/services/api/allset.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const seed = (value: number) => new Uint8Array(32).fill(value);

describe('send handler history', () => {
  it('preserves a confirmed Fast-to-Fast settlement when local history fails', async () => {
    const senderSeed = seed(1);
    const senderSigner = new Signer(senderSeed);
    const recipientSigner = new Signer(seed(2));
    const account: AccountInfo = {
      kind: 'single',
      name: 'alice',
      fastAddress: await senderSigner.getFastAddress(),
      evmAddress: '0x0000000000000000000000000000000000000000',
      isDefault: true,
      encrypted: false,
      createdAt: new Date(0).toISOString(),
    };
    const recipient = await recipientSigner.getFastAddress();
    const lines: string[] = [];
    const results: unknown[] = [];
    let submissions = 0;

    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, {
        resolveAccount: () => Effect.succeed(account),
        export: () => Effect.succeed({ seed: senderSeed, account }),
        list: () => Effect.succeed([account]),
      } as never),
      Layer.succeed(AllSet, {
        createWallet: () => Effect.die('bridge wallet must not be created'),
        createExecutor: () => Effect.die('bridge executor must not be created'),
        deposit: () => Effect.die('bridge deposit must not run'),
        withdraw: () => Effect.die('bridge withdrawal must not run'),
      } as never),
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: true,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(NetworkConfigService, {
        resolve: () => Effect.succeed(bundledNetworks.testnet!),
      } as never),
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
        ok: (data: unknown) => Effect.sync(() => void results.push(data)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      }),
      Layer.succeed(Prompt, {
        password: () => Effect.die('password prompt must not run'),
        input: () => Effect.die('input prompt must not run'),
        confirm: () => Effect.die('confirmation must not run'),
      } as never),
      Layer.succeed(HistoryStore, {
        record: () => Effect.fail(new DatabaseError({ message: 'history database unavailable' })),
      } as never),
      Layer.succeed(FastRpc, {
        getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
        submitTransaction: () =>
          Effect.sync(() => {
            submissions++;
            return { type: 'Success' };
          }),
      } as never),
    );

    const exit = await Effect.runPromiseExit(
      send
        .handler({
          address: recipient,
          amount: '1',
          token: 'testUSDC',
          replacePending: false,
        } as never)
        .pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe('Success');
    expect(submissions).toBe(1);
    expect(lines.join('\n')).toContain('confirmed, but local history could not be updated');
    expect(lines.join('\n')).toContain('Sent 1 testUSDC');
    expect(results).toEqual([
      expect.objectContaining({
        txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        route: 'fast',
      }),
    ]);
  });
});
