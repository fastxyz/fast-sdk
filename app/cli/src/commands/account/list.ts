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
        ["NAME", "KIND", "FAST ADDRESS", "EVM ADDRESS", "DEFAULT"],
        entries.map((e) => {
          const kind =
            e.kind === "single"
              ? "single"
              : `multisig ${e.multisigConfig.quorum}-of-${e.multisigConfig.signers.length}`;
          return [
            e.name,
            kind,
            e.fastAddress,
            e.kind === "single" ? e.evmAddress : "—",
            e.isDefault ? "✓" : "",
          ];
        }),
      );
      yield* output.ok({
        accounts: entries.map((e) =>
          e.kind === "single"
            ? {
                name: e.name,
                kind: "single",
                fastAddress: e.fastAddress,
                evmAddress: e.evmAddress,
                isDefault: e.isDefault,
              }
            : {
                name: e.name,
                kind: "multisig",
                fastAddress: e.fastAddress,
                quorum: e.multisigConfig.quorum,
                signerCount: e.multisigConfig.signers.length,
                isDefault: e.isDefault,
              },
        ),
      });
    }),
};
