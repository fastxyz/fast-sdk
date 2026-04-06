import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountList = defineCommand({
  meta: { name: "list", description: "List all accounts" },
  args: { ...globalArgs },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        const output = yield* Output;

        const entries = yield* accounts.list();

        yield* output.humanTable(
          ["NAME", "FAST ADDRESS", "EVM ADDRESS", "DEFAULT"],
          entries.map((e) => [
            e.name,
            e.fastAddress,
            e.evmAddress,
            e.isDefault ? "✓" : "",
          ]),
        );
        yield* output.success({
          accounts: entries.map((e) => ({
            name: e.name,
            fastAddress: e.fastAddress,
            evmAddress: e.evmAddress,
            isDefault: e.isDefault,
          })),
        });
      }),
    ),
});
