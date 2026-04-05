import { Args, Command } from '@effect/cli';
import { toHex } from '@fastxyz/fast-sdk';
import { Effect, Option } from 'effect';
import { AccountStore } from '../../services/account-store.js';
import { PasswordService } from '../../services/password-service.js';
import { Output } from '../../services/output.js';
import { CliConfig } from '../../services/cli-config.js';
import { UserCancelledError } from '../../errors/index.js';

const nameArg = Args.text({ name: 'name' }).pipe(Args.withDescription('Account alias. Defaults to the default account.'), Args.optional);

export const accountExport = Command.make('export', { name: nameArg }, (args) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const passwordService = yield* PasswordService;
    const output = yield* Output;
    const config = yield* CliConfig;

    const accountName = Option.isSome(args.name) ? args.name.value : (yield* accounts.resolveAccount(config.account)).name;

    // Interactive confirmation
    if (!config.nonInteractive && !config.json) {
      const confirmed = yield* output.confirm('⚠ This will display the private key. Continue?');
      if (!confirmed) {
        return yield* Effect.fail(new UserCancelledError());
      }
    }

    const pwd = yield* passwordService.resolve();
    const { seed, entry } = yield* accounts.export_(accountName, pwd);
    const privateKeyHex = toHex(seed);

    yield* output.humanLine(`⚠ Private key for "${entry.name}":`);
    yield* output.humanLine(privateKeyHex);
    yield* output.success({
      name: entry.name,
      privateKey: privateKeyHex,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  }),
).pipe(Command.withDescription('Export (decrypt) the private key'));
