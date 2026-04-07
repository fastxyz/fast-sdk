import type { Command } from "../index.js";
import { getEvmErc20Balance } from "@fastxyz/allset-sdk";
import { bech32m } from "bech32";
import { Effect } from "effect";
import type { InfoBalanceArgs } from "../../cli.js";
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

      const account = yield* accounts.resolveAccount(config.account);
      const fastAddress = account.fastAddress;
      const evmAddress = account.evmAddress;
      const senderBytes = fromFastAddress(fastAddress);

      // Fetch all Fast token balances
      const accountInfo = yield* rpc.getAccountInfo({
        address: senderBytes,
        tokenBalancesFilter: [],
        stateKeyFilter: null,
        certificateByNonce: null,
      } as never);

      // Build tokenId hex → Fast balance map
      const fastBalanceMap = new Map<string, bigint>();
      if (accountInfo && typeof accountInfo === "object" && "tokenBalance" in accountInfo) {
        const tokenBalances = (accountInfo as { tokenBalance: Array<[Uint8Array, bigint]> }).tokenBalance;
        for (const [tokenIdBytes, amount] of tokenBalances) {
          fastBalanceMap.set(bytesToHex(tokenIdBytes), amount);
        }
      }

      yield* output.humanLine(`Balances for ${account.name}`);
      yield* output.humanLine(`  Fast address: ${fastAddress}`);
      yield* output.humanLine(`  EVM address:  ${evmAddress}`);

      if (!networkConfig.allSet) {
        yield* output.humanLine("");
        yield* output.humanLine("No bridge chains configured for this network.");
        yield* output.ok({ address: fastAddress, evmAddress, chains: [] });
        return;
      }

      type TokenRow = { token: string; evmBalance: string; fastBalance: string };
      type ChainOutput = { chain: string; tokens: TokenRow[] };
      const chainsOutput: ChainOutput[] = [];

      for (const [chainName, chainConfig] of Object.entries(networkConfig.allSet.chains)) {
        const tokenRows: TokenRow[] = [];

        for (const [tokenName, token] of Object.entries(chainConfig.tokens)) {
          // Apply --token filter
          if (args.token) {
            const f = args.token.toLowerCase().replace(/^0x/, "");
            const idHex = token.fastTokenId.replace(/^0x/, "").toLowerCase();
            if (tokenName.toLowerCase() !== args.token.toLowerCase() && !idHex.includes(f)) continue;
          }

          const { decimals } = token;
          const tokenIdHex = token.fastTokenId.replace(/^0x/, "").toLowerCase();

          const evmRaw = yield* Effect.promise(() =>
            getEvmErc20Balance(chainConfig.evmRpcUrl, token.evmAddress, evmAddress).catch(() => 0n),
          );
          const fastRaw = fastBalanceMap.get(tokenIdHex) ?? 0n;

          tokenRows.push({
            token: tokenName,
            evmBalance: formatAmount(evmRaw, decimals),
            fastBalance: formatAmount(fastRaw, decimals),
          });
        }

        if (tokenRows.length === 0) continue;

        yield* output.humanLine("");
        yield* output.humanLine(`${chainName}`);
        yield* output.humanTable(
          ["TOKEN", "EVM BALANCE", "FAST BALANCE"],
          tokenRows.map((r) => [r.token, r.evmBalance, r.fastBalance]),
        );
        chainsOutput.push({ chain: chainName, tokens: tokenRows });
      }

      yield* output.ok({ address: fastAddress, evmAddress, chains: chainsOutput });
    }),
};

