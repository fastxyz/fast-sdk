import { defineCommand } from 'citty';
import { accountCommand } from './commands/account/index.js';
import { infoCommand } from './commands/info/index.js';
import { networkCommand } from './commands/network/index.js';
import { sendCommand } from './commands/send.js';

export const rootCommand = defineCommand({
  meta: {
    name: 'fast',
    version: '0.1.0',
    description: 'Fast CLI - Account, network, and transaction management',
  },
  subCommands: {
    account: accountCommand,
    network: networkCommand,
    info: infoCommand,
    send: sendCommand,
  },
});
