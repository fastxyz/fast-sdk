import { Effect } from "effect";
import type { AccountListArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const accountList: Command<AccountListArgs> = {
  cmd: "account-list",
  handler: (_args: AccountListArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;

      const entries = yield* accounts.list();

      yield* output.humanTable(
        ["NAME", "FAST ADDRESS", "EVM ADDRESS", "DEFAULT"],
        entries.map((e) => [
          e.name,
          e.fastAddress,
          e.kind === "single" ? e.evmAddress : "(multisig)",
          e.isDefault ? "✓" : "",
        ]),
      );
      yield* output.ok({
        accounts: entries.map((e) => ({
          name: e.name,
          kind: e.kind,
          fastAddress: e.fastAddress,
          evmAddress: e.kind === "single" ? e.evmAddress : null,
          isDefault: e.isDefault,
        })),
      });
    }),
};
