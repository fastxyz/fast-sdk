import type { FundFastUsdArgs } from '../../cli.js';
import type { Command } from '../index.js';
import { chooseFundLink } from './select.js';

export const fundFastUsd: Command<FundFastUsdArgs> = {
  cmd: 'fund-fastusd',
  handler: (args) =>
    chooseFundLink({ address: args.to, amount: args.amount }, 'Deprecated: `fast fund fastusd` now opens a method selector. Use `fast fund`.'),
};
