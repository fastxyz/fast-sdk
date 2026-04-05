import { defineCommand } from 'citty';
import { accountCreate } from './create.js';
import { accountDelete } from './delete.js';
import { accountExport } from './export.js';
import { accountImport } from './import.js';
import { accountInfo } from './info.js';
import { accountList } from './list.js';
import { accountSetDefault } from './set-default.js';

export const accountCommand = defineCommand({
  meta: { name: 'account', description: 'Manage accounts' },
  subCommands: {
    create: accountCreate,
    import: accountImport,
    list: accountList,
    'set-default': accountSetDefault,
    info: accountInfo,
    export: accountExport,
    delete: accountDelete,
  },
});
