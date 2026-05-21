import { Effect } from 'effect';
import { writeFileSync } from 'node:fs';
import type { MultisigExportArgs } from '../../cli.js';
import { FileIOError, WalletKindMismatchError } from '../../errors/index.js';
import { stringifyMultiSigWalletConfig } from '../../schemas/multisig-wallet.js';
import { Output } from '../../services/output.js';
import { AccountStore } from '../../services/storage/account.js';
import type { Command } from '../index.js';

export const multisigExport: Command<MultisigExportArgs> = {
  cmd: 'multisig-export',
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const account = yield* accounts.get(args.name);
      if (account.kind !== 'multisig') {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: args.name,
            expected: 'multisig',
            hint: 'Use "fast account export" for single-signer accounts.',
          }),
        );
      }
      const json = stringifyMultiSigWalletConfig(account.multisigConfig);
      if (args.out) {
        yield* Effect.try({
          try: () => writeFileSync(args.out!, json + '\n'),
          catch: (cause) =>
            new FileIOError({
              message: `Failed to write multisig wallet config to "${args.out}"`,
              cause,
            }),
        });
        yield* output.humanLine(`Wrote ${args.out}`);
        yield* output.ok({ path: args.out });
      } else {
        yield* output.humanLine(json);
        yield* output.ok(account.multisigConfig);
      }
    }),
};
