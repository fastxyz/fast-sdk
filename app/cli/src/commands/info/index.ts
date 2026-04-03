import { Command } from '@effect/cli';
import { infoStatus } from './status.js';
import { infoBalance } from './balance.js';
import { infoTx } from './tx.js';
import { infoHistory } from './history.js';

export const infoCommand = Command.make('info').pipe(
  Command.withDescription('Query network and account information'),
  Command.withSubcommands([infoStatus, infoBalance, infoTx, infoHistory]),
);
