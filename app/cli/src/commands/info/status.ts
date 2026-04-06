import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { Config } from "../../services/cli-config.js";
import { FastRpc } from "../../services/fast-rpc.js";
import { NetworkConfigService } from "../../services/network-config.js";
import { Output } from "../../services/output.js";

export const infoStatus = defineCommand({
  meta: { name: "status", description: "Health check for current network" },
  args: { ...globalArgs },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const rpc = yield* FastRpc;
        const output = yield* Output;
        const config = yield* Config;
        const networkConfig = yield* NetworkConfigService;

        const network = yield* networkConfig.resolve(config.network);

        const healthy = yield* rpc
          .getAccountInfo({
            address: new Uint8Array(32),
            tokenBalancesFilter: null,
            stateKeyFilter: null,
            certificateByNonce: null,
          } as never)
          .pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          );

        const defaultNetwork = yield* networkConfig.getDefault();
        const isDefault = config.network === defaultNetwork;

        const defaultLabel = isDefault ? " (default)" : "";
        yield* output.humanLine(`Network: ${config.network}${defaultLabel}`);
        yield* output.humanLine(
          `  Fast RPC:      ${network.rpcUrl}        ${healthy ? "✓ healthy" : "✗ unreachable"}`,
        );
        yield* output.humanLine(`  Explorer:      ${network.explorerUrl}`);

        yield* output.success({
          network: config.network,
          fast: {
            rpcUrl: network.rpcUrl,
            explorerUrl: network.explorerUrl,
            healthy,
          },
        });
      }),
    ),
});
