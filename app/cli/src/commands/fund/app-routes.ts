import type { FundCardArgs, FundCryptoAppArgs, FundUsdcAppArgs } from '../../cli.js';
import { Effect } from 'effect';
import { GLOBAL_SWITCHES, tokenizeArgv } from '../../argv.js';
import { InvalidUsageError } from '../../errors/index.js';
import type { Command } from '../index.js';
import { FUND_METHODS, openFundAppLink } from './app-link.js';

/** Value-taking options across the `fast fund usdc` forms (app link, `fiat`, `crypto`). */
const FUND_USDC_VALUE_FLAGS = ['--address', '--amount', '--chain', '--token'];
/** Options that take no value across those forms, global ones included. */
const FUND_USDC_SWITCHES = new Set<string>([...GLOBAL_SWITCHES, '--eip-7702']);

/**
 * Explain a rejected `fast fund usdc ...` command line whose third operand is not a
 * subcommand. Option values are skipped, so `--address fast1...` is not reported as an
 * unknown subcommand. Undefined when there is no subcommand, when it is a valid one, or
 * when it follows an unknown option (`--bogus value`): it is then most likely that
 * option's value, and the unknown-option message is the one to show.
 */
export const diagnoseFundUsdcArgv = (argv: readonly string[]): string | undefined => {
  const { operands, operandIndexes } = tokenizeArgv(argv, FUND_USDC_VALUE_FLAGS);
  const third = operands[2];
  if (third === undefined || third === 'fiat' || third === 'crypto') return undefined;
  const previous = argv[operandIndexes[2]! - 1];
  if (previous !== undefined && previous.startsWith('--') && !previous.includes('=') && !FUND_USDC_SWITCHES.has(previous)) {
    return undefined;
  }
  return `Unknown subcommand '${third}' for 'fund usdc'. Use no subcommand for the app USDC flow, or choose: fiat (deprecated), crypto`;
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
