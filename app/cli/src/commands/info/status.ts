import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { FastRpc } from '../../services/fast-rpc.js';
import { Output } from '../../services/output.js';
import { CliConfig } from '../../services/cli-config.js';
import { NetworkConfigService } from '../../services/network-config.js';

export const infoStatus = Command.make('status', {}, () =>
  Effect.gen(function* () {
    const rpc = yield* FastRpc;
    const output = yield* Output;
    const config = yield* CliConfig;
    const networkConfig = yield* NetworkConfigService;

    const network = yield* networkConfig.resolve(config.network).pipe(Effect.mapError((e) => e));

    // Try a simple RPC call to check health
    let healthy = false;
    let blockHeight: number | null = null;
    try {
      // getAccountInfo with a dummy address to test connectivity
      yield* rpc.getAccountInfo({ sender: new Uint8Array(32) });
      healthy = true;
    } catch {
      // If it fails, still report the network info but mark as unhealthy
    }

    const defaultNetwork = yield* networkConfig.getDefault();
    const isDefault = config.network === defaultNetwork;

    const defaultLabel = isDefault ? ' (default)' : '';
    yield* output.humanLine(`Network: ${config.network}${defaultLabel}`);
    yield* output.humanLine(`  Fast RPC:      ${network.rpcUrl}        ${healthy ? '✓ healthy' : '✗ unreachable'}`);
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
).pipe(Command.withDescription('Health check for current network'));
