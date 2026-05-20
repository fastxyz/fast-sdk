import { Effect } from "effect";
import type { FundFastUsdArgs } from "../../cli.js";
import { InvalidAddressError, InvalidAmountError, InvalidUsageError } from "../../errors/index.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import type { Command } from "../index.js";
import { buildFundFastUsdUrl } from "./fastusd-url.js";

const isPositiveDecimal = (s: string): boolean => {
  if (s.trim() === "") return false;
  if (!/^\d+(\.\d+)?$/.test(s)) return false;
  return Number.parseFloat(s) > 0;
};

export const fundFastUsd: Command<FundFastUsdArgs> = {
  cmd: "fund-fastusd",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;

      if (config.network !== "mainnet") {
        return yield* Effect.fail(
          new InvalidUsageError({
            message:
              `fastUSD funding is only available on mainnet. ` +
              `Current network: ${config.network}. ` +
              `Switch with --network mainnet.`,
          }),
        );
      }

      let address: string;
      if (args.to) {
        if (!args.to.startsWith("fast1")) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid Fast address "${args.to}". Must start with fast1.`,
            }),
          );
        }
        address = args.to;
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        address = account.fastAddress;
      }

      if (args.amount !== undefined && !isPositiveDecimal(args.amount)) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `Invalid amount "${args.amount}". Expected a positive decimal (e.g. 10 or 1.5).`,
          }),
        );
      }

      const url = buildFundFastUsdUrl(address, args.amount);

      yield* output.humanLine("Open this URL in your browser to fund your account:");
      yield* output.humanLine("");
      yield* output.humanLine(`  ${url}`);
      yield* output.humanLine("");
      yield* output.ok({ url, address });
    }),
};
