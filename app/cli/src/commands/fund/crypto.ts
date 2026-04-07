import { Effect } from "effect";
import type { FundCryptoArgs } from "../../cli.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

export const fundCrypto: Command<FundCryptoArgs> = {
  cmd: "fund-crypto",
  handler: (_args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;

      const account = yield* accounts.resolveAccount(config.account);

      yield* output.humanLine("Send tokens to this EVM address to fund your account:");
      yield* output.humanLine("");
      yield* output.humanLine(`  EVM address:  ${account.evmAddress}`);
      yield* output.humanLine(`  Fast address: ${account.fastAddress}`);
      yield* output.humanLine(`  Account:      ${account.name}`);
      yield* output.humanLine("");

      yield* output.ok({
        evmAddress: account.evmAddress,
        fastAddress: account.fastAddress,
        accountName: account.name,
      });
    }),
};
