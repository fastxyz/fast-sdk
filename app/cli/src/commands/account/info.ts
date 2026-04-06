import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { AccountStore } from "../../services/account/account-store.js";
import { Config } from "../../services/cli-config.js";
import { Output } from "../../services/output.js";

export const accountInfo = defineCommand({
  meta: { name: "info", description: "Show account addresses" },
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
        const output = yield* Output;
        const config = yield* Config;

        const info = args.name
          ? yield* accounts.get(args.name)
          : yield* accounts.resolveAccount(config.account);

        const defaultLabel = info.isDefault ? " (default)" : "";
        yield* output.humanLine(`Account: ${info.name}${defaultLabel}`);
        yield* output.humanLine(`  Fast address: ${info.fastAddress}`);
        yield* output.humanLine(`  EVM address:  ${info.evmAddress}`);
        yield* output.success({
          name: info.name,
          fastAddress: info.fastAddress,
          evmAddress: info.evmAddress,
          isDefault: info.isDefault,
        });
      }),
    ),
});
