import type { Command } from "../index.js";
import { bech32m } from "bech32";
import { Effect } from "effect";
import type { InfoBalanceArgs } from "../../cli.js";
import { InvalidAddressError } from "../../errors/index.js";
import { FastRpc } from "../../services/api/fast.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import { NetworkConfigService } from "../../services/storage/network.js";

const fromFastAddress = (address: string): Uint8Array => {
  const { prefix, words } = bech32m.decode(address);
  if (prefix !== "fast")
    throw new Error(`Expected "fast" prefix, got "${prefix}"`);
  return new Uint8Array(bech32m.fromWords(words));
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

const formatAmount = (amount: bigint, decimals: number): string => {
  const s = amount.toString();
  if (decimals === 0) return s;
  const padded = s.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals) || "0";
  const fracPart = padded.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

export const infoBalance: Command<InfoBalanceArgs> = {
  cmd: "info-balance",
  handler: (args: InfoBalanceArgs) =>
  Effect.gen(function* () {
    const rpc = yield* FastRpc;
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* ClientConfig;
    const netService = yield* NetworkConfigService;
    const networkConfig = yield* netService.resolve(config.network);

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
      tokenBalancesFilter: [],
      stateKeyFilter: null,
      certificateByNonce: null,
    } as never);

    const balances: Array<{
      tokenName: string;
      tokenId: string;
      amount: string;
      decimals: number;
      formatted: string;
    }> = [];

    // Build tokenId hex → { name, decimals } lookup from network config
    const tokenLookup = new Map<string, { name: string; decimals: number }>();
    if (networkConfig.allSet) {
      for (const chainConfig of Object.values(networkConfig.allSet.chains)) {
        for (const [name, token] of Object.entries(chainConfig.tokens)) {
          const hexId = token.fastTokenId.replace(/^0x/, "").toLowerCase();
          if (!tokenLookup.has(hexId)) tokenLookup.set(hexId, { name, decimals: token.decimals });
        }
      }
    }

    if (accountInfo && typeof accountInfo === "object" && "tokenBalance" in accountInfo) {
      // Decoded via AccountInfoResponseFromRpc: tokenBalance is Array<[Uint8Array, bigint]>
      const tokenBalances = (accountInfo as { tokenBalance: Array<[Uint8Array, bigint]> }).tokenBalance;
      for (const [tokenIdBytes, amount] of tokenBalances) {
        const tokenIdHex = bytesToHex(tokenIdBytes);
        const known = tokenLookup.get(tokenIdHex);
        const decimals = known?.decimals ?? 6;
        const tokenName = known?.name ?? `${tokenIdHex.slice(0, 8)}...`;

        if (args.token) {
          const filter = args.token.toLowerCase().replace(/^0x/, "");
          if (tokenName.toLowerCase() !== args.token.toLowerCase() && !tokenIdHex.includes(filter)) continue;
        }

        balances.push({
          tokenName,
          tokenId: `0x${tokenIdHex}`,
          amount: amount.toString(),
          decimals,
          formatted: formatAmount(amount, decimals),
        });
      }
    }

    yield* output.humanLine(`Balances for ${fastAddress}`);
    yield* output.humanLine("");
    yield* output.humanTable(
      ["TOKEN", "BALANCE", "TOKEN ID"],
      balances.map((b) => [b.tokenName, b.formatted, b.tokenId]),
    );
    yield* output.ok({ address: fastAddress, balances });
  }),
};
