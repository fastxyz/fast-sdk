import { Effect } from "effect";
import type { NetworkListArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkListHandler = (_args: NetworkListArgs) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    const networks = yield* networkConfig.list();

    yield* output.humanTable(
      ["NAME", "TYPE", "DEFAULT"],
      networks.map((n) => [n.name, n.type, n.isDefault ? "✓" : ""]),
    );
    yield* output.ok({
      networks: networks.map((n) => ({
        name: n.name,
        type: n.type,
        isDefault: n.isDefault,
      })),
    });
  });
