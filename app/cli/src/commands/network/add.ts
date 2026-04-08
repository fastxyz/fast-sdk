import type { Command } from "../index.js";
import { Effect } from "effect";
import type { NetworkAddArgs } from "../../cli.js";
import { InvalidUsageError } from "../../errors/index.js";
import { validateName } from "../../services/validate.js";
import { Output } from "../../services/output.js";
import { NetworkConfigService } from "../../services/storage/network.js";

export const networkAdd: Command<NetworkAddArgs> = {
  cmd: "network-add",
  handler: (args: NetworkAddArgs) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService;
    const output = yield* Output;

    const nameErr = validateName(args.name, "Network name");
    if (nameErr) {
      return yield* Effect.fail(new InvalidUsageError({ message: nameErr }));
    }

    yield* networkConfig.add(args.name, args.config);

    yield* output.humanLine(`Added network "${args.name}"`);
    yield* output.ok({ name: args.name });
  }),
};
