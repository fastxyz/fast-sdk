import { Args, Command } from "@effect/cli"
import { Effect } from "effect"
import { NetworkConfigService } from "../../services/network-config.js"
import { Output } from "../../services/output.js"

const nameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Name of the custom network to remove"),
)

export const networkRemove = Command.make("remove", { name: nameArg }, (args) =>
  Effect.gen(function* () {
    const networkConfig = yield* NetworkConfigService
    const output = yield* Output

    yield* networkConfig.remove(args.name)

    yield* output.humanLine(`Removed network "${args.name}"`)
    yield* output.success({ name: args.name, removed: true })
  }),
).pipe(Command.withDescription("Remove a custom network"))
