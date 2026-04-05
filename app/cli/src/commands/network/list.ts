import { defineCommand } from 'citty';
import { Effect } from 'effect';
import { globalArgs } from '../../cli-globals.js';
import { runHandler } from '../../cli-runner.js';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkList = defineCommand({
  meta: { name: 'list', description: 'List available networks' },
  args: { ...globalArgs },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    const networks = yield* networkConfig.list();

    yield* output.humanTable(
      ['NAME', 'TYPE', 'DEFAULT'],
      networks.map((n) => [n.name, n.type, n.isDefault ? '✓' : '']),
    );
    yield* output.success({
      networks: networks.map((n) => ({
        name: n.name,
        type: n.type,
        isDefault: n.isDefault,
      })),
    });
  })),
});
