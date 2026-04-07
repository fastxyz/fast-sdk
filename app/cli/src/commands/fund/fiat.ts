import { Effect } from "effect";
import type { FundFiatArgs } from "../../cli.js";
import { InvalidAddressError } from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";

const RAMP_BASE = "https://ramp.fast.xyz";

export const fundFiat: Command<FundFiatArgs> = {
  cmd: "fund-fiat",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;

      let address: string;
      if (args.address) {
        if (!args.address.startsWith("fast1")) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid Fast address "${args.address}". Must start with fast1.`,
            }),
          );
        }
        address = args.address;
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        address = account.fastAddress;
      }

      const url = `${RAMP_BASE}/?fastAddress=${address}`;

      yield* output.humanLine("Open this URL in your browser to fund your account:");
      yield* output.humanLine("");
      yield* output.humanLine(`  ${url}`);
      yield* output.humanLine("");

      yield* output.ok({ url, address, tokenName: "USDC" });
    }),
};
