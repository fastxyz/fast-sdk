import type { FundCardArgs, FundCryptoAppArgs, FundUsdcAppArgs } from '../../cli.js';
import { Effect } from 'effect';
import { InvalidUsageError } from '../../errors/index.js';
import type { Command } from '../index.js';
import { FUND_METHODS, openFundAppLink } from './app-link.js';

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
