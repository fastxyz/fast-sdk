import { Effect } from "effect";
import type { CommandName, NetworkRemoveArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkRemove = {
  cmd: "network-remove" as CommandName,
  handler: (args: NetworkRemoveArgs) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.remove(args.name);

    yield* output.humanLine(`Removed network "${args.name}"`);
    yield* output.ok({ name: args.name, removed: true });
  }),
};
