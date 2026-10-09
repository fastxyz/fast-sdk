import { parse } from '@optique/core/parser';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { parser } from '../../src/cli.js';
import { send } from '../../src/commands/send.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { AllSet } from '../../src/services/api/allset.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';
import { runMultisigWithdrawal } from '../../src/services/multisig-withdrawal.js';

vi.mock('../../src/services/multisig-withdrawal.js', () => ({
  runMultisigWithdrawal: vi.fn(async () => ({ status: 'awaiting-transfer-signatures', txHash: `0x${'11'.repeat(32)}` })),
  liveWithdrawalDependencies: vi.fn(() => ({})),
}));
vi.mock('../../src/services/storage/withdrawal-journal.js', () => ({
  withWithdrawalJournal: (_f: unknown, run: (s: unknown) => unknown) => run({}),
}));
vi.mock('../../src/services/signer-resolver.js', () => ({ resolveSigner: () => Effect.succeed({ kind: 'multisig', signer: {} }) }));

describe('send multisig AllSet routing', () => {
  it('parses the explicit resumable journal option', () => {
    const parsed = parse(parser, [
      'send',
      `0x${'03'.repeat(20)}`,
      '1',
      '--to-chain',
      'arbitrum-sepolia',
      '--withdrawal',
      '/private/withdrawal.json',
    ]);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.value).toMatchObject({ withdrawal: '/private/withdrawal.json' });
  });
  async function run(withdrawal?: string, extra = {}) {
    const results: unknown[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(AccountStore, {
        resolveAccount: () => Effect.succeed({ kind: 'multisig', name: 'treasury', fastAddress: 'fast1-test' }),
      } as never),
      Layer.succeed(AllSet, { withdraw: () => Effect.die('single-signer bridge must not run') } as never),
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
        ok: (x: unknown) => Effect.sync(() => void results.push(x)),
        debug: () => Effect.void,
      } as never),
      Layer.succeed(Prompt, {} as never),
      Layer.succeed(HistoryStore, { record: () => Effect.die('not settled') } as never),
    );
    const exit = await Effect.runPromiseExit(
      send
        .handler({
          address: `0x${'03'.repeat(20)}`,
          amount: '1.000001',
          token: 'testUSDC',
          toChain: 'arbitrum-sepolia',
          withdrawal,
          replacePending: false,
          ...extra,
        } as never)
        .pipe(Effect.provide(layer)),
    );
    return { exit, results };
  }
  it('routes multisig withdrawals to the resumable engine with exact base units', async () => {
    vi.mocked(runMultisigWithdrawal).mockClear();
    const { exit, results } = await run('/private/withdrawal.json');
    expect(exit._tag).toBe('Success');
    expect(runMultisigWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '1000001', receiver: `0x${'03'.repeat(20)}` }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(results).toEqual([expect.objectContaining({ status: 'awaiting-transfer-signatures' })]);
  });
  it.each([undefined, '/private/withdrawal.json'])('fails closed for missing journal or unsupported memo', async (withdrawal) => {
    vi.mocked(runMultisigWithdrawal).mockClear();
    const { exit } = await run(withdrawal, withdrawal ? { memo: 'unsupported' } : {});
    expect(exit._tag).toBe('Failure');
    expect(runMultisigWithdrawal).not.toHaveBeenCalled();
  });
});
