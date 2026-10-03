import type { FundCardArgs, FundCryptoAppArgs, FundUsdcAppArgs } from '../../cli.js';
import { Effect } from 'effect';
import { tokenizeArgv } from '../../argv.js';
import { InvalidUsageError } from '../../errors/index.js';
import type { Command } from '../index.js';
import { FUND_METHODS, openFundAppLink } from './app-link.js';

/** Value-taking options across the `fast fund usdc` forms (app link, `fiat`, `crypto`). */
const FUND_USDC_VALUE_FLAGS = ['--address', '--amount', '--chain', '--token'];

/**
 * Explain a rejected `fast fund usdc ...` command line whose third operand is not a
 * subcommand. Option values are skipped, so `--address fast1...` is not reported as an
 * unknown subcommand. Undefined when there is no subcommand or it is a valid one.
 */
export const diagnoseFundUsdcArgv = (argv: readonly string[]): string | undefined => {
  const third = tokenizeArgv(argv, FUND_USDC_VALUE_FLAGS).operands[2];
  return third !== undefined && third !== 'fiat' && third !== 'crypto'
    ? `Unknown subcommand '${third}' for 'fund usdc'. Use no subcommand for the app USDC flow, or choose: fiat (deprecated), crypto`
    : undefined;
};

export const fundCard: Command<FundCardArgs> = {
  cmd: 'fund-card',
  handler: (args) => openFundAppLink('card', args),
};

export const fundUsdcApp: Command<FundUsdcAppArgs> = {
  cmd: 'fund-usdc-app',
  handler: (args) => openFundAppLink('usdc', args),
};

export const fundCryptoApp: Command<FundCryptoAppArgs> = {
  cmd: 'fund-crypto-app',
  handler: (args) => {
    if (args.supplier !== 'coinbase' && args.supplier !== 'swapper') {
      return Effect.fail(
        new InvalidUsageError({
          message: `Unsupported crypto supplier "${args.supplier}". Choose ${FUND_METHODS.slice(2).join(' or ')}.`,
        }),
      );
    }
    return openFundAppLink(args.supplier, args);
  },
};
