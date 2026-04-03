import { Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { rootCommand } from "./cli.js"
import { toErrorCode, toExitCode } from "./errors/index.js"

const app = Command.run(rootCommand, {
  name: "fast",
  version: "0.1.0",
})

const main = app(process.argv).pipe(
  Effect.catchAll((error: unknown) => {
    const err = error as Record<string, unknown>
    const exitCode = toExitCode(err as { _tag: string })
    const errorCode = toErrorCode(err as { _tag: string })
    const message =
      typeof err?.message === "string" ? err.message : String(error)
    const isJson = process.argv.includes("--json")

    if (isJson) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: { code: errorCode, message } }, null, 2)}\n`,
      )
    } else if (message) {
      process.stderr.write(`Error: ${message}\n`)
    }

    return Effect.sync(() => process.exit(exitCode))
  }),
  Effect.provide(NodeContext.layer),
)

NodeRuntime.runMain(main as Effect.Effect<void>)
