import type { Command } from "../index.js";
import { Effect } from "effect";
import type { InfoBridgeTokensArgs } from "../../cli.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const infoBridgeTokens: Command<InfoBridgeTokensArgs> = {
  cmd: "info-bridge-tokens",
  handler: (_args: InfoBridgeTokensArgs) =>
    Effect.gen(function* () {
      const netService = yield* NetworkConfigService;
      const output = yield* Output;
      const config = yield* ClientConfig;

      const networkConfig = yield* netService.resolve(config.network);

      if (!networkConfig.allSet) {
        yield* output.humanLine(`No bridge configuration for network "${config.network}".`);
        yield* output.ok({ tokens: [] });
        return;
      }

      // Build a map: fastTokenId → { symbol, decimals, chains[] }
      const tokenMap = new Map<
        string,
        { symbol: string; tokenId: string; decimals: number; chains: { chain: string; evmAddress: string }[] }
      >();

      for (const [chainName, chainConfig] of Object.entries(networkConfig.allSet.chains)) {
        for (const [symbol, tokenConfig] of Object.entries(chainConfig.tokens)) {
          const existing = tokenMap.get(tokenConfig.fastTokenId);
          if (existing) {
            existing.chains.push({ chain: chainName, evmAddress: tokenConfig.evmAddress });
          } else {
            tokenMap.set(tokenConfig.fastTokenId, {
              symbol,
              tokenId: tokenConfig.fastTokenId,
              decimals: tokenConfig.decimals,
              chains: [{ chain: chainName, evmAddress: tokenConfig.evmAddress }],
            });
          }
        }
      }

      const tokens = Array.from(tokenMap.values());

      yield* output.humanLine(`Bridgeable tokens on ${config.network}:\n`);

      for (const t of tokens) {
        yield* output.humanTable(
          ["SYMBOL", "TOKEN ID", "DECIMALS"],
          [[t.symbol, t.tokenId, String(t.decimals)]],
        );
        yield* output.humanLine("  Supported chains:");
        for (const c of t.chains) {
          yield* output.humanLine(`    ${c.chain.padEnd(24)} ${c.evmAddress}`);
        }
        yield* output.humanLine("");
      }

      yield* output.ok({
        tokens: tokens.map((t) => ({
          symbol: t.symbol,
          tokenId: t.tokenId,
          decimals: t.decimals,
          chains: t.chains,
        })),
      });
    }),
};
