import { Effect } from "effect";
import type { CommandName, NetworkAddArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkAdd = {
  cmd: "network-add" as CommandName,
  handler: (args: NetworkAddArgs) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.add(args.name, args.config);

    yield* output.humanLine(`Added network "${args.name}"`);
    yield* output.ok({ name: args.name });
  }),
};
