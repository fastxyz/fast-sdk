import { toHex } from "@fastxyz/fast-sdk";
import { Effect } from "effect";
import type { AccountExportArgs } from "../../cli.js";
import { Config } from "../../services/config/config.js";
import { Output } from "../../services/output.js";
import { Prompt } from "../../services/prompt.js";
import { AccountStore } from "../../services/storage/account.js";

export const accountExportHandler = (args: AccountExportArgs) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const prompt = yield* Prompt;
    const output = yield* Output;
    const config = yield* Config;

    const accountName =
      args.name ?? (yield* accounts.resolveAccount(config.account)).name;

    const confirmed = yield* prompt.confirm(
      "⚠ This will display the private key. Continue?",
    );
    if (!confirmed) return;

    const pwd = yield* prompt.password();
    const { seed, entry } = yield* accounts.export_(accountName, pwd);
    const privateKeyHex = toHex(seed);

    yield* output.humanLine(`⚠ Private key for "${entry.name}":`);
    yield* output.humanLine(privateKeyHex);
    yield* output.ok({
      name: entry.name,
      privateKey: privateKeyHex,
      fastAddress: entry.fastAddress,
      evmAddress: entry.evmAddress,
    });
  });
