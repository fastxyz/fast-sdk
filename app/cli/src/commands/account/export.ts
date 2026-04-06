import { toHex } from "@fastxyz/fast-sdk";
import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { UserCancelledError } from "../../errors/index.js";
import { AccountStore } from "../../services/account-store.js";
import { Config } from "../../services/cli-config.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";

export const accountExport = defineCommand({
  meta: { name: "export", description: "Export (decrypt) the private key" },
  args: {
    ...globalArgs,
    name: {
      type: "positional",
      description: "Account alias. Defaults to the default account.",
      required: false,
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const prompt = yield* Prompt;
        const output = yield* Output;
        const config = yield* Config;

        const accountName =
          args.name ?? (yield* accounts.resolveAccount(config.account)).name;

        const confirmed = yield* prompt.confirm("⚠ This will display the private key. Continue?");
        if (!confirmed) {
          return yield* Effect.fail(new UserCancelledError());
        }

        const pwd = yield* prompt.password();
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
    ),
});
