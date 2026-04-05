import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkSetDefault = defineCommand({
  meta: { name: 'set-default', description: 'Set the default network' },
  args: {
    ...globalArgs,
    name: {
      type: 'positional',
      description: 'Network name',
      required: true,
    },
  },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.setDefault(args.name);

    yield* output.humanLine(`Default network set to "${args.name}"`);
    yield* output.success({ name: args.name });
  })),
});
