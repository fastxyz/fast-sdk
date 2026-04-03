import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';

export const accountList = Command.make('list', {}, () =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;

    const entries = yield* accounts.list();

    yield* output.humanTable(
      ['NAME', 'FAST ADDRESS', 'EVM ADDRESS', 'DEFAULT'],
      entries.map((e) => [e.name, e.fastAddress, e.evmAddress, e.isDefault ? '✓' : '']),
    );
    yield* output.success({
      accounts: entries.map((e) => ({
        name: e.name,
        fastAddress: e.fastAddress,
        evmAddress: e.evmAddress,
        isDefault: e.isDefault,
      })),
    });
  }),
).pipe(Command.withDescription('List all accounts'));
