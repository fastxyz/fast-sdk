import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { AccountStore } from "../../services/account-store.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";

export const accountDelete = defineCommand({
  meta: { name: "delete", description: "Delete an account" },
  args: {
    ...globalArgs,
    name: {
      type: "positional",
      description: "Account alias to delete",
      required: true,
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const output = yield* Output;
        const prompt = yield* Prompt;

        const confirmed = yield* prompt.confirm(`Delete account "${args.name}"?`);
        if (!confirmed) return;

        yield* accounts.delete_(args.name);

        yield* output.humanLine(`Deleted account "${args.name}"`);
        yield* output.success({ name: args.name, deleted: true });
      }),
    ),
});
