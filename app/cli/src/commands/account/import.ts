import { readFileSync } from "node:fs";
import { fromHex } from "@fastxyz/sdk";
import { Effect, Option } from "effect";
import type { AccountImportArgs } from "../../cli.js";
import { InvalidUsageError } from "../../errors/index.js";
import { decryptLegacyKeystore } from "../../services/legacy-keystore.js";
import { validateName } from "../../services/validate.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const accountImport: Command<AccountImportArgs> = {
  cmd: "account-import",
  handler: (args: AccountImportArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const prompt = yield* Prompt;
      const output = yield* Output;

      if ([args.privateKey, args.keyFile, args.legacyKeystore].filter((value) => value !== undefined).length !== 1) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: "Provide exactly one of --private-key, --key-file or --legacy-keystore",
          }),
        );
      }

      const parseHexSeed = (hex: string) =>
        Effect.try({
          try: () => fromHex(hex),
          catch: (e) =>
            new InvalidUsageError({
              message: `Invalid hex in private key: ${e instanceof Error ? e.message : String(e)}`,
            }),
        });

      let seed: Uint8Array;
      let legacyPassword: string | undefined;
      if (args.privateKey !== undefined) {
        seed = yield* parseHexSeed(args.privateKey);
        if (seed.length !== 32) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message:
                "Private key must be exactly 32 bytes (64 hex characters)",
            }),
          );
        }
      } else if (args.keyFile !== undefined) {
        const keyFilePath = args.keyFile;
        const content = yield* Effect.try({
          try: () => readFileSync(keyFilePath, "utf-8"),
          catch: (e) =>
            new InvalidUsageError({
              message: `Cannot read key file: ${e instanceof Error ? e.message : String(e)}`,
            }),
        });
        const parsed = yield* Effect.try({
          try: () => JSON.parse(content) as { privateKey?: string },
          catch: () =>
            new InvalidUsageError({ message: "Key file is not valid JSON" }),
        });
        if (!parsed.privateKey) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message: "Key file must contain a 'privateKey' field",
            }),
          );
        }
        seed = yield* parseHexSeed(parsed.privateKey);
        if (seed.length !== 32) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message:
                "Private key must be exactly 32 bytes (64 hex characters)",
            }),
          );
        }
      } else {
        const path = args.legacyKeystore;
        if (!path) {
          return yield* Effect.fail(new InvalidUsageError({ message: "Legacy keystore path is required" }));
        }
        const content = yield* Effect.try({
          try: () => readFileSync(path, "utf-8"),
          catch: () => new InvalidUsageError({ message: "Cannot read legacy keystore" }),
        });
        const parsed = yield* Effect.try({
          try: () => JSON.parse(content) as unknown,
          catch: () => new InvalidUsageError({ message: "Legacy keystore is not valid JSON" }),
        });
        const password = yield* prompt.password();
        if (password.length === 0) {
          return yield* Effect.fail(new InvalidUsageError({ message: "Legacy keystore password is required" }));
        }
        legacyPassword = password;
        seed = yield* Effect.tryPromise({
          try: () => decryptLegacyKeystore(parsed, password),
          catch: (e) =>
            new InvalidUsageError({
              message: e instanceof Error ? e.message : "Invalid legacy keystore",
            }),
        });
      }

      const name = args.name ?? (yield* accounts.nextAutoName());

      if (args.name) {
        const nameErr = validateName(args.name, "Account name");
        if (nameErr) {
          return yield* Effect.fail(new InvalidUsageError({ message: nameErr }));
        }
      }

      const pwd = legacyPassword === undefined ? yield* prompt.password({ required: false }) : Option.some(legacyPassword);
      const entry = yield* accounts.import(name, seed, Option.getOrNull(pwd));

      if (Option.isNone(pwd)) {
        yield* output.humanLine("No password set. Key stored unencrypted.");
      }

      yield* output.humanLine(`Imported account "${entry.name}"`);
      yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
      yield* output.humanLine(`  EVM address:  ${entry.evmAddress}`);
      yield* output.ok({
        name: entry.name,
        fastAddress: entry.fastAddress,
        evmAddress: entry.evmAddress,
      });
    }),
};
