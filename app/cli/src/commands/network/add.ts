import { Args, Command, Options } from '@effect/cli';
import { Effect } from 'effect';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

const nameArg = Args.text({ name: 'name' }).pipe(Args.withDescription('Name for the custom network'));

const configOption = Options.file('config').pipe(Options.withDescription('Path to network config JSON file'));

export const networkAdd = Command.make('add', { name: nameArg, config: configOption }, (args) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.add(args.name, args.config);

    yield* output.humanLine(`Added network "${args.name}"`);
    yield* output.success({ name: args.name });
  }),
).pipe(Command.withDescription('Add a custom network config'));
