import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';

export const accountSetDefault = defineCommand({
  meta: { name: 'set-default', description: 'Set the default account' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Alias of an existing account',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;

    yield* accounts.setDefault(args.name);
    const info = yield* accounts.get(args.name);

    yield* output.humanLine(`Default account set to "${args.name}"`);
    yield* output.success({
      name: info.name,
      fastAddress: info.fastAddress,
    });
  })),
});
