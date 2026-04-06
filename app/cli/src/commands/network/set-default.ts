import type { Command } from "../index.js";
import { Effect } from "effect";
import type { NetworkSetDefaultArgs } from "../../cli.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkSetDefault: Command = {
  cmd: "network-set-default",
  handler: (args: NetworkSetDefaultArgs) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    yield* networkConfig.setDefault(args.name);

    yield* output.humanLine(`Default network set to "${args.name}"`);
    yield* output.ok({ name: args.name });
  }),
};
