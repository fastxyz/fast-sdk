import { defineCommand } from 'citty';
import { infoBalance } from './balance.js';
import { infoHistory } from './history.js';
import { infoStatus } from './status.js';
import { infoTx } from './tx.js';

export const infoCommand = defineCommand({
  meta: { name: 'info', description: 'Query network and account information' },
  subCommands: {
    status: infoStatus,
    balance: infoBalance,
    tx: infoTx,
    history: infoHistory,
  },
});
