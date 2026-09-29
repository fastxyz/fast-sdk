import { Effect } from 'effect';
import type { FundSelectorArgs } from '../../cli.js';
import { InvalidUsageError } from '../../errors/index.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { Prompt } from '../../services/prompt.js';
import { AccountStore } from '../../services/storage/account.js';
import { ensureMultisigNetwork } from '../../services/signer-resolver.js';
import type { Command } from '../index.js';
import { FUND_METHODS, openFundAppLink, type FundMethod } from './app-link.js';

const parseMethod = (input: string): FundMethod | undefined => {
  const normalized = input.trim().toLowerCase();
  if (normalized === '1' || normalized === 'card') return 'card';
  if (normalized === '2' || normalized === 'usdc') return 'usdc';
  if (normalized === '3' || normalized === 'coinbase') return 'coinbase';
  if (normalized === '4' || normalized === 'swapper') return 'swapper';
  return undefined;
};

type FundSelectorInput = Pick<FundSelectorArgs, 'address' | 'amount'>;

export const chooseFundLink = (args: FundSelectorInput, deprecationMessage?: string) =>
  Effect.gen(function* () {
    const config = yield* ClientConfig;

    if (config.network !== 'mainnet') {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: `Hosted funding links are only available on mainnet. Current network: ${config.network}. Switch with --network mainnet.`,
        }),
      );
    }

    if (config.nonInteractive || config.json) {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: `Choose a funding method explicitly: fast fund card, fast fund usdc, or fast fund crypto --supplier <${FUND_METHODS.slice(2).join('|')}>.`,
        }),
      );
    }

    let address = args.address;
    if (address === undefined) {
      const accounts = yield* AccountStore;
      const account = yield* accounts.resolveAccount(config.account);
      if (account.kind === 'multisig') {
        yield* ensureMultisigNetwork(account, config.network);
      }
      address = account.fastAddress;
    }

    const output = yield* Output;
    yield* output.humanLine('Choose how to add funds (the Fast-side asset is fastUSD):');
    yield* output.humanLine('  1. Card');
    yield* output.humanLine('  2. USDC from another network');
    yield* output.humanLine('  3. Coinbase');
    yield* output.humanLine('  4. Swapper');
    const prompt = yield* Prompt;
    const answer = yield* prompt.input({ label: 'Method (1-4):' });
    const method = parseMethod(answer);
    if (!method) {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: `Unknown funding method "${answer}". Choose card, usdc, coinbase, or swapper.`,
        }),
      );
    }

    return yield* openFundAppLink(method, { ...args, address }, deprecationMessage);
  });

export const fundSelector: Command<FundSelectorArgs> = {
  cmd: 'fund-selector',
  handler: (args) => chooseFundLink(args),
};
