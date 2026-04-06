import type { Command } from "../index.js";
import { readFileSync } from "node:fs";
import { fromHex } from "@fastxyz/fast-sdk";
import { Effect } from "effect";
import type { AccountImportArgs } from "../../cli.js";
import { InvalidUsageError } from "../../errors/index.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountImport: Command<AccountImportArgs> = {
  cmd: "account-import",
  handler: (args: AccountImportArgs) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const prompt = yield* Prompt;
    const output = yield* Output;

    if (args.privateKey && args.keyFile) {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: "--private-key and --key-file are mutually exclusive",
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
    if (args.privateKey) {
      seed = yield* parseHexSeed(args.privateKey);
      if (seed.length !== 32) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message:
              "Private key must be exactly 32 bytes (64 hex characters)",
          }),
        );
      }
    } else if (args.keyFile) {
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
      return yield* Effect.fail(
        new InvalidUsageError({
          message: "Provide --private-key or --key-file",
        }),
      );
    }

    const name = args.name ?? (yield* accounts.nextAutoName());

    const pwd = yield* prompt.password();
    const entry = yield* accounts.import_(name, seed, pwd);

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
