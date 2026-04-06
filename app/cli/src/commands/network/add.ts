import type { Command } from "../index.js";
import { Effect } from "effect";
import type { NetworkAddArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkAdd: Command = {
  cmd: "network-add",
  handler: (args: NetworkAddArgs) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.add(args.name, args.config);

    yield* output.humanLine(`Added network "${args.name}"`);
    yield* output.ok({ name: args.name });
  }),
};
