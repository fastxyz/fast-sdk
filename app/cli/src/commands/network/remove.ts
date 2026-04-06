import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkRemove = defineCommand({
  meta: { name: "remove", description: "Remove a custom network" },
  args: {
    ...globalArgs,
    name: {
      type: "positional",
      description: "Name of the custom network to remove",
      required: true,
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const networkConfig = yield* NetworkConfigService;
        const output = yield* Output;

        yield* networkConfig.remove(args.name);

        yield* output.humanLine(`Removed network "${args.name}"`);
        yield* output.success({ name: args.name, removed: true });
      }),
    ),
});
