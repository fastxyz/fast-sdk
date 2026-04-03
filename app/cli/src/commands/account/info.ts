import { Args, Command } from '@effect/cli';
import { Effect, Option } from 'effect';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';
import { CliConfig } from '../../services/cli-config.js';

const nameArg = Args.text({ name: 'name' }).pipe(Args.withDescription('Account alias. Defaults to the default account.'), Args.optional);

export const accountInfo = Command.make('info', { name: nameArg }, (args) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* CliConfig;

    const info = Option.isSome(args.name) ? yield* accounts.get(args.name.value) : yield* accounts.resolveAccount(config.account);

    const defaultLabel = info.isDefault ? ' (default)' : '';
    yield* output.humanLine(`Account: ${info.name}${defaultLabel}`);
    yield* output.humanLine(`  Fast address: ${info.fastAddress}`);
    yield* output.humanLine(`  EVM address:  ${info.evmAddress}`);
    yield* output.success({
      name: info.name,
      fastAddress: info.fastAddress,
      evmAddress: info.evmAddress,
      isDefault: info.isDefault,
    });
  }),
).pipe(Command.withDescription('Show account addresses'));
