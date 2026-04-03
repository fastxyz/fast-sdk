import { Context, Effect, Layer, Option } from "effect"
import { PasswordRequiredError } from "../errors/index.js"
import { CliConfig } from "./cli-config.js"

export interface PasswordServiceShape {
  readonly resolve: () => Effect.Effect<string, PasswordRequiredError>
}

export class PasswordService extends Context.Tag("PasswordService")<
  PasswordService,
  PasswordServiceShape
>() {}

const promptPassword = (
  prompt: string,
): Effect.Effect<string, PasswordRequiredError> =>
  Effect.async<string, PasswordRequiredError>((resume) => {
    const readline =
      require("node:readline") as typeof import("node:readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    })

    process.stderr.write(prompt)

    // Suppress echo for password entry
    const origWrite = (rl as any)._writeToOutput
    ;(rl as any)._writeToOutput = () => {}

    rl.question("", (answer) => {
      ;(rl as any)._writeToOutput = origWrite
      rl.close()
      process.stderr.write("\n")
      resume(Effect.succeed(answer))
    })
  })

export const PasswordServiceLive = Layer.effect(
  PasswordService,
  Effect.gen(function* () {
    const config = yield* CliConfig

    return {
      resolve: () =>
        Effect.gen(function* () {
          if (Option.isSome(config.password)) {
            return config.password.value
          }

          const envPassword = process.env.FAST_PASSWORD
          if (envPassword !== undefined && envPassword !== "") {
            return envPassword
          }

          if (config.nonInteractive || config.json) {
            return yield* Effect.fail(new PasswordRequiredError())
          }

          return yield* promptPassword("Password: ")
        }),
    }
  }),
)
