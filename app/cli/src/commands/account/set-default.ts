import { Args, Command } from "@effect/cli"
import { Effect } from "effect"
import { AccountStore } from "../../services/account-store.js"
import { Output } from "../../services/output.js"

const nameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Alias of an existing account"),
)

export const accountSetDefault = Command.make("set-default", { name: nameArg }, (args) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore
    const output = yield* Output

    yield* accounts.setDefault(args.name)
    const info = yield* accounts.get(args.name)

    yield* output.humanLine(`Default account set to "${args.name}"`)
    yield* output.success({
      name: info.name,
      fastAddress: info.fastAddress,
    })
  }),
).pipe(Command.withDescription("Set the default account"))
