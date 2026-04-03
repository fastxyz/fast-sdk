import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { InvalidAddressError } from "../../errors/index.js";
import { AccountStore } from "../../services/account-store.js";
import { CliConfig } from "../../services/cli-config.js";
import { FastRpc } from "../../services/fast-rpc.js";
import { Output } from "../../services/output.js";

const addressOption = Options.text("address").pipe(
  Options.optional,
  Options.withDescription("Any Fast address (fast1...) to query"),
);

const tokenOption = Options.text("token").pipe(
  Options.optional,
  Options.withDescription("Filter by token"),
);

const fromFastAddress = (address: string): Uint8Array => {
  // Using bech32m decode — import from the SDK
  const { bech32m } = require("bech32") as typeof import("bech32");
  const { prefix, words } = bech32m.decode(address);
  if (prefix !== "fast")
    throw new Error(`Expected "fast" prefix, got "${prefix}"`);
  return new Uint8Array(bech32m.fromWords(words));
};

export const infoBalance = Command.make(
  "balance",
  { address: addressOption, token: tokenOption },
  (args) =>
    Effect.gen(function* () {
      const rpc = yield* FastRpc;
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* CliConfig;

      // Resolve sender address
      let fastAddress: string;
      let senderBytes: Uint8Array;

      if (Option.isSome(args.address)) {
        fastAddress = args.address.value;
        if (!fastAddress.startsWith("fast1")) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid Fast address: ${fastAddress}`,
            }),
          );
        }
        try {
          senderBytes = fromFastAddress(fastAddress);
        } catch {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `Invalid Fast address: ${fastAddress}`,
            }),
          );
        }
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        fastAddress = account.fastAddress;
        senderBytes = fromFastAddress(fastAddress);
      }

      const accountInfo = yield* rpc.getAccountInfo({ sender: senderBytes });

      // Extract balances from account info
      const balances: Array<{
        tokenName: string;
        tokenId: string;
        amount: string;
        decimals: number;
        formatted: string;
      }> = [];

      if (
        accountInfo &&
        typeof accountInfo === "object" &&
        "token_balance" in accountInfo
      ) {
        const tokenBalances = accountInfo.token_balance as
          | Record<string, bigint>
          | undefined;
        if (tokenBalances) {
          for (const [tokenId, amount] of Object.entries(tokenBalances)) {
            // Default to 6 decimals (USDC-like), will be refined when we have token info
            const decimals = 6;
            const amountStr = String(amount);
            const formatted = formatAmount(amountStr, decimals);

            // Filter by token if specified
            if (Option.isSome(args.token)) {
              const filter = args.token.value.toLowerCase();
              if (
                tokenId !== args.token.value &&
                !tokenId.toLowerCase().includes(filter)
              ) {
                continue;
              }
            }

            balances.push({
              tokenName: tokenId.slice(0, 10) + "...",
              tokenId,
              amount: amountStr,
              decimals,
              formatted,
            });
          }
        }
      }

      yield* output.humanLine(`Balances for ${fastAddress}`);
      yield* output.humanLine("");
      yield* output.humanTable(
        ["TOKEN", "BALANCE", "TOKEN ID"],
        balances.map((b) => [b.tokenName, b.formatted, b.tokenId]),
      );
      yield* output.success({ address: fastAddress, balances });
    }),
).pipe(Command.withDescription("Show token balances for an address"));

const formatAmount = (amountStr: string, decimals: number): string => {
  if (decimals === 0) return amountStr;
  const padded = amountStr.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals) || "0";
  const fracPart = padded.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};
