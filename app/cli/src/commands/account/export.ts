import { toHex } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { AccountExportArgs } from "../../cli.js";
import { WalletKindMismatchError } from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const accountExport: Command<AccountExportArgs> = {
  cmd: "account-export",
  handler: (args: AccountExportArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const prompt = yield* Prompt;
      const output = yield* Output;
      const config = yield* ClientConfig;

      const accountName =
        args.name ?? (yield* accounts.resolveAccount(config.account)).name;

      const accountInfo = yield* accounts.get(accountName);
      if (accountInfo.kind !== "single") {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: accountName,
            expected: "single",
            hint: 'Use "fast multisig export" to export a wallet config.',
          }),
        );
      }

      const confirmed = yield* prompt.confirm(
        "⚠ This will display the private key. Continue?",
      );
      if (!confirmed) return;

      const pwd = accountInfo.encrypted
        ? yield* prompt.password()
        : null;
      const { seed, entry } = yield* accounts.export(accountName, pwd);
      const privateKeyHex = toHex(seed);

      yield* output.humanLine(`⚠ Private key for "${entry.name}":`);
      yield* output.humanLine(privateKeyHex);
      yield* output.ok({
        name: entry.name,
        privateKey: privateKeyHex,
        fastAddress: entry.fastAddress,
        evmAddress: entry.kind === "single" ? entry.evmAddress : null,
      });
    }),
};
