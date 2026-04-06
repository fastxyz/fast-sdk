import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { AccountStore } from "../../services/account-store.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";

export const accountCreate = defineCommand({
  meta: { name: "create", description: "Create a new account" },
  args: {
    ...globalArgs,
    name: {
      type: "string",
      description: "Human-readable alias for the account",
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const prompt = yield* Prompt;
        const output = yield* Output;

        const name = args.name ?? (yield* accounts.nextAutoName());

        const pwd = yield* prompt.password();
        const seed = crypto.getRandomValues(new Uint8Array(32));
        const entry = yield* accounts.create(name, seed, pwd);

        yield* output.humanLine(`Created account "${entry.name}"`);
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
