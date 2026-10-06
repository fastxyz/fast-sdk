import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { fundUsdcCrypto } from '../../src/commands/fund/usdc/crypto.js';
import { bundledNetworks } from '../../src/config/networks.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import { AllSet } from '../../src/services/api/allset.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

describe('fund usdc crypto history', () => {
  it('records a self-funded EVM deposit as incoming', async () => {
    const account: AccountInfo = {
      kind: 'single',
      name: 'alice',
      fastAddress: 'fast1recipient',
      evmAddress: `0x${'11'.repeat(20)}`,
      isDefault: true,
      encrypted: false,
      createdAt: new Date(0).toISOString(),
    };
    const recorded: HistoryEntry[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, {
        resolveAccount: () => Effect.succeed(account),
        export: () => Effect.succeed({ seed: new Uint8Array(32).fill(1), account }),
      } as never),
      Layer.succeed(AllSet, {
        erc20Balance: () => Effect.succeed(2_000_000n),
        nativeBalance: () => Effect.succeed(1n),
        createWallet: () => ({}),
        createExecutor: () => ({}),
        deposit: () => Effect.succeed({ txHash: `0x${'ab'.repeat(32)}`, estimatedTime: '1 minute' }),
      } as never),
      Layer.succeed(ClientConfig, {
        json: true,
        debug: false,
        nonInteractive: true,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(NetworkConfigService, { resolve: () => Effect.succeed(bundledNetworks.testnet!) } as never),
      Layer.succeed(Output, { humanLine: () => Effect.void, ok: () => Effect.void, debug: () => Effect.void } as never),
      Layer.succeed(Prompt, { password: () => Effect.die('password prompt must not run') } as never),
      Layer.succeed(HistoryStore, { record: (entry: HistoryEntry) => Effect.sync(() => void recorded.push(entry)) } as never),
    );

    await Effect.runPromise(
      fundUsdcCrypto.handler({ chain: 'arbitrum-sepolia', token: 'testUSDC', amount: '1' } as never).pipe(Effect.provide(layer)),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ route: 'evm-to-fast', to: account.fastAddress, recordedDirection: 'in' });
  });
});
