import { Effect } from "effect";
import type { AccountDeleteArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountDeleteHandler = (args: AccountDeleteArgs) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const prompt = yield* Prompt;

    const confirmed = yield* prompt.confirm(
      `Delete account "${args.name}"?`,
    );
    if (!confirmed) return;

    yield* accounts.delete_(args.name);

    yield* output.humanLine(`Deleted account "${args.name}"`);
    yield* output.success({ name: args.name, deleted: true });
  });
