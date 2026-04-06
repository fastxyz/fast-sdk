import { Effect } from "effect";
import type { AccountInfoArgs, CommandName } from "../../cli.js";
import { Config } from "../../services/config/config.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountInfo = {
  cmd: "account-info" as CommandName,
  handler: (args: AccountInfoArgs) =>
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
    yield* output.ok({
      name: info.name,
      fastAddress: info.fastAddress,
      evmAddress: info.evmAddress,
      isDefault: info.isDefault,
    });
  }),
};
