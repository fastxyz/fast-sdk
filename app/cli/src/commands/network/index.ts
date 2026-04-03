import { Command } from '@effect/cli';
import { networkList } from './list.js';
import { networkSetDefault } from './set-default.js';
import { networkAdd } from './add.js';
import { networkRemove } from './remove.js';

export const networkCommand = Command.make('network').pipe(
  Command.withDescription('Manage networks'),
  Command.withSubcommands([networkList, networkSetDefault, networkAdd, networkRemove]),
);
