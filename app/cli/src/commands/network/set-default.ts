import { Args, Command } from '@effect/cli';
import { Effect } from 'effect';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

const nameArg = Args.text({ name: 'name' }).pipe(Args.withDescription('Network name'));

export const networkSetDefault = Command.make('set-default', { name: nameArg }, (args) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.setDefault(args.name);

    yield* output.humanLine(`Default network set to "${args.name}"`);
    yield* output.success({ name: args.name });
  }),
).pipe(Command.withDescription('Set the default network'));
