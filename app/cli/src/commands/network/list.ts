import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { NetworkConfigService } from '../../services/network-config.js';
import { Output } from '../../services/output.js';

export const networkList = Command.make('list', {}, () =>
  Effect.gen(function* () {
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
  }),
).pipe(Command.withDescription('List available networks'));
