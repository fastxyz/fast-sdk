import type { Command } from "../index.js";
import { Effect } from "effect";
import type { InfoStatusArgs } from "../../cli.js";
import { FastRpc } from "../../services/api/fast.js";
import { Config } from "../../services/config/config.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const infoStatus: Command<InfoStatusArgs> = {
  cmd: "info-status",
  handler: (_args: InfoStatusArgs) =>
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

    yield* output.ok({
      network: config.network,
      fast: {
        rpcUrl: network.rpcUrl,
        explorerUrl: network.explorerUrl,
        healthy,
      },
    });
  }),
};
