import type { FundUsdcFiatArgs } from '../../../cli.js';
import type { Command } from '../../index.js';
import { openFundAppLink } from '../app-link.js';

export const fundUsdcFiat: Command<FundUsdcFiatArgs> = {
  cmd: 'fund-usdc-fiat',
  handler: (args) => openFundAppLink('card', args, 'Deprecated: `fast fund usdc fiat` now opens the Card flow. Use `fast fund card`.'),
};
