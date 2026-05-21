import { fromFastAddress } from "@fastxyz/sdk";
import { Effect } from "effect";
import type { FundUsdcFiatArgs } from "../../../cli.js";
import { InvalidAddressError, InvalidUsageError } from "../../../errors/index.js";
import { ClientConfig } from "../../../services/config/client.js";
import { Output } from "../../../services/output.js";
import { AccountStore } from "../../../services/storage/account.js";
import type { Command } from "../../index.js";
import { buildRampUrl } from "./fiat-url.js";

const isValidFastAddress = (address: string): boolean => {
  try {
    fromFastAddress(address);
    return true;
  } catch {
    return false;
  }
};

export const fundUsdcFiat: Command<FundUsdcFiatArgs> = {
  cmd: "fund-usdc-fiat",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;

      if (config.network !== "mainnet") {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `Fiat funding is only available on mainnet. Current network: ${config.network}. Switch with --network mainnet.`,
          }),
        );
      }

      let address: string;
      if (args.address) {
        if (!isValidFastAddress(args.address)) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid Fast address "${args.address}". Must be a valid bech32m address with the "fast" prefix.`,
            }),
          );
        }
        address = args.address;
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        address = account.fastAddress;
      }

      const url = buildRampUrl(address);

      yield* output.humanLine("Open this URL in your browser to fund your account:");
      yield* output.humanLine("");
      yield* output.humanLine(`  ${url}`);
      yield* output.humanLine("");

      yield* output.ok({ url, address, tokenName: "USDC" });
    }),
};
