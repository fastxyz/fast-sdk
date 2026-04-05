import { Command, Options } from '@effect/cli';
import { fromHex } from '@fastxyz/fast-sdk';
import { Effect, Option } from 'effect';
import { readFileSync } from 'node:fs';
import { InvalidUsageError } from '../../errors/index.js';
import { AccountStore } from '../../services/account-store.js';
import { Output } from '../../services/output.js';
import { PasswordService } from '../../services/password-service.js';

const nameOption = Options.text('name').pipe(Options.optional, Options.withDescription('Alias for the account'));

const privateKeyOption = Options.text('private-key').pipe(Options.optional, Options.withDescription('Hex-encoded Ed25519 seed (0x-prefixed or raw)'));

const keyFileOption = Options.text('key-file').pipe(Options.optional, Options.withDescription('Path to a JSON file containing a privateKey field'));

export const accountImport = Command.make('import', { name: nameOption, privateKey: privateKeyOption, keyFile: keyFileOption }, (args) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const password = yield* PasswordService;
    const output = yield* Output;

    // Validate mutually exclusive flags
    if (Option.isSome(args.privateKey) && Option.isSome(args.keyFile)) {
      return yield* Effect.fail(new InvalidUsageError({ message: '--private-key and --key-file are mutually exclusive' }));
    }

    // Get the seed bytes
    let seed: Uint8Array;
    if (Option.isSome(args.privateKey)) {
      const hex = args.privateKey.value;
      seed = fromHex(hex);
      if (seed.length !== 32) {
        return yield* Effect.fail(new InvalidUsageError({ message: 'Private key must be exactly 32 bytes (64 hex characters)' }));
      }
    } else if (Option.isSome(args.keyFile)) {
      const content = readFileSync(args.keyFile.value, 'utf-8');
      const parsed = JSON.parse(content) as { privateKey?: string };
      if (!parsed.privateKey) {
        return yield* Effect.fail(new InvalidUsageError({ message: "Key file must contain a 'privateKey' field" }));
      }
      seed = fromHex(parsed.privateKey);
      if (seed.length !== 32) {
        return yield* Effect.fail(new InvalidUsageError({ message: 'Private key must be exactly 32 bytes (64 hex characters)' }));
      }
    } else {
      return yield* Effect.fail(new InvalidUsageError({ message: 'Provide --private-key or --key-file' }));
    }

    const name = Option.isSome(args.name) ? args.name.value : yield* accounts.nextAutoName();

    const pwd = yield* password.resolve();
    const entry = yield* accounts.import_(name, seed, pwd);

    yield* output.humanLine(`Imported account "${entry.name}"`);
    yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
    yield* output.humanLine(`  EVM address:  ${entry.evmAddress}`);
    yield* output.success({
      name: entry.name,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  }),
).pipe(Command.withDescription('Import an existing private key'));
