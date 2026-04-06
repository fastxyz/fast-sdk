import { Effect } from "effect";
import type { AccountCreateArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountCreateHandler = (args: AccountCreateArgs) =>
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
    yield* output.ok({
      name: entry.name,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  });
