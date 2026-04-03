import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { UserCancelledError } from "../../errors/index.js";
import { AccountStore } from "../../services/account-store.js";
import { CliConfig } from "../../services/cli-config.js";
import { Output } from "../../services/output.js";

const nameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Account alias to delete"),
);

export const accountDelete = Command.make("delete", { name: nameArg }, (args) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* CliConfig;

    // Interactive confirmation
    if (!config.nonInteractive && !config.json) {
      const confirmed = yield* output.confirm(`Delete account "${args.name}"?`);
      if (!confirmed) {
        return yield* Effect.fail(new UserCancelledError());
      }
    }

    yield* accounts.delete_(args.name);

    yield* output.humanLine(`Deleted account "${args.name}"`);
    yield* output.success({ name: args.name, deleted: true });
  }),
).pipe(Command.withDescription("Delete an account"));
