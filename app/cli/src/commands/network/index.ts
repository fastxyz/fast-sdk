import { defineCommand } from 'citty';
import { networkAdd } from './add.js';
import { networkList } from './list.js';
import { networkRemove } from './remove.js';
import { networkSetDefault } from './set-default.js';

export const networkCommand = defineCommand({
  meta: { name: 'network', description: 'Manage networks' },
  subCommands: {
    list: networkList,
    'set-default': networkSetDefault,
    add: networkAdd,
    remove: networkRemove,
  },
});
