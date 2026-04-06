import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { UserCancelledError } from "../../errors/index.js";
import { AccountStore } from "../../services/account/account-store.js";
import { Config } from "../../services/cli-config.js";
import { Output } from "../../services/output.js";

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
        const config = yield* Config;

        if (!config.nonInteractive && !config.json) {
          const confirmed = yield* output.confirm(
            `Delete account "${args.name}"?`,
          );
          if (!confirmed) {
            return yield* Effect.fail(new UserCancelledError());
          }
        }

        yield* accounts.delete_(args.name);

        yield* output.humanLine(`Deleted account "${args.name}"`);
        yield* output.success({ name: args.name, deleted: true });
      }),
    ),
});
