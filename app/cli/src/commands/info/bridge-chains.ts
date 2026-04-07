import type { Command } from "../index.js";
import { Effect } from "effect";
import type { InfoBridgeChainsArgs } from "../../cli.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const infoBridgeChains: Command<InfoBridgeChainsArgs> = {
  cmd: "info-bridge-chains",
  handler: (_args: InfoBridgeChainsArgs) =>
    Effect.gen(function* () {
      const netService = yield* NetworkConfigService;
      const output = yield* Output;
      const config = yield* ClientConfig;

      const networkConfig = yield* netService.resolve(config.network);

      if (!networkConfig.allSet) {
        yield* output.humanLine(`No bridge configuration for network "${config.network}".`);
        yield* output.ok({ chains: [] });
        return;
      }

      const chains = Object.entries(networkConfig.allSet.chains).map(
        ([name, chainConfig]) => ({
          name,
          chainId: chainConfig.chainId,
          bridgeContract: chainConfig.bridgeContract,
          tokens: Object.keys(chainConfig.tokens),
        }),
      );

      yield* output.humanLine(`Supported bridge chains on ${config.network}:\n`);
      yield* output.humanTable(
        ["CHAIN", "CHAIN ID", "BRIDGE CONTRACT", "TOKENS"],
        chains.map((c) => [c.name, String(c.chainId), c.bridgeContract, c.tokens.join(", ")]),
      );

      yield* output.ok({ chains });
    }),
};
