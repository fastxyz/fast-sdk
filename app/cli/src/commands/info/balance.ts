import { bech32m } from "bech32";
import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { InvalidAddressError } from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { Config } from "../../services/config/config.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";

const fromFastAddress = (address: string): Uint8Array => {
  const { prefix, words } = bech32m.decode(address);
  if (prefix !== "fast")
    throw new Error(`Expected "fast" prefix, got "${prefix}"`);
  return new Uint8Array(bech32m.fromWords(words));
};

const formatAmount = (amountStr: string, decimals: number): string => {
  if (decimals === 0) return amountStr;
  const padded = amountStr.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals) || "0";
  const fracPart = padded.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

export const infoBalance = defineCommand({
  meta: { name: "balance", description: "Show token balances for an address" },
  args: {
    ...globalArgs,
    address: {
      type: "string",
      description: "Any Fast address (fast1...) to query",
    },
    token: { type: "string", description: "Filter by token" },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const rpc = yield* FastRpc;
        const accounts = yield* AccountStore;
        const output = yield* Output;
        const config = yield* Config;

        let fastAddress: string;
        let senderBytes: Uint8Array;

        if (args.address) {
          fastAddress = args.address;
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

        const accountInfo = yield* rpc.getAccountInfo({
          address: senderBytes,
          tokenBalancesFilter: null,
          stateKeyFilter: null,
          certificateByNonce: null,
        });

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
              const decimals = 6;
              const amountStr = String(amount);
              const formatted = formatAmount(amountStr, decimals);

              if (args.token) {
                const filter = args.token.toLowerCase();
                if (
                  tokenId !== args.token &&
                  !tokenId.toLowerCase().includes(filter)
                ) {
                  continue;
                }
              }

              balances.push({
                tokenName: `${tokenId.slice(0, 10)}...`,
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
    ),
});
