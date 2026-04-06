import { defineCommand } from "citty";
import { Effect } from "effect";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkAdd = defineCommand({
  meta: { name: "add", description: "Add a custom network config" },
  args: {
    ...globalArgs,
    name: {
      type: "positional",
      description: "Name for the custom network",
      required: true,
    },
    config: {
      type: "string",
      description: "Path to network config JSON file",
      required: true,
    },
  },
  run: ({ args }) =>
    runHandler(
      args,
      Effect.gen(function* () {
        const networkConfig = yield* NetworkConfigService;
        const output = yield* Output;

        yield* networkConfig.add(args.name, args.config);

        yield* output.humanLine(`Added network "${args.name}"`);
        yield* output.success({ name: args.name });
      }),
    ),
});
