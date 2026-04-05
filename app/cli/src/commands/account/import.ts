import { readFileSync } from "node:fs";
import { fromHex } from "@fastxyz/fast-sdk";
import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { InvalidUsageError } from "../../errors/index.js";
import { AccountStore } from "../../services/account-store.js";
import { Output } from "../../services/output.js";
import { PasswordService } from "../../services/password-service.js";

export const accountImport = defineCommand({
  meta: { name: "import", description: "Import an existing private key" },
  args: {
    ...globalArgs,
    name: { type: "string", description: "Alias for the account" },
    "private-key": {
      type: "string",
      description: "Hex-encoded Ed25519 seed (0x-prefixed or raw)",
    },
    "key-file": {
      type: "string",
      description: "Path to a JSON file containing a privateKey field",
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const password = yield* PasswordService;
        const output = yield* Output;

        if (args["private-key"] && args["key-file"]) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message: "--private-key and --key-file are mutually exclusive",
            }),
          );
        }

        let seed: Uint8Array;
        if (args["private-key"]) {
          seed = fromHex(args["private-key"]);
          if (seed.length !== 32) {
            return yield* Effect.fail(
              new InvalidUsageError({
                message:
                  "Private key must be exactly 32 bytes (64 hex characters)",
              }),
            );
          }
        } else if (args["key-file"]) {
          const keyFilePath = args["key-file"];
          const content = yield* Effect.try({
            try: () => readFileSync(keyFilePath, "utf-8"),
            catch: (e) =>
              new InvalidUsageError({
                message: `Cannot read key file: ${e instanceof Error ? e.message : String(e)}`,
              }),
          });
          const parsed = yield* Effect.try({
            try: () => JSON.parse(content) as { privateKey?: string },
            catch: () => new InvalidUsageError({ message: "Key file is not valid JSON" }),
          });
          if (!parsed.privateKey) {
            return yield* Effect.fail(
              new InvalidUsageError({
                message: "Key file must contain a 'privateKey' field",
              }),
            );
          }
          seed = fromHex(parsed.privateKey);
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
    ),
});
