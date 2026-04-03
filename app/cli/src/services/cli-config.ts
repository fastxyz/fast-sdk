import { Command, Options } from "@effect/cli"
import { Context, Layer, type Option } from "effect"

// --- Global CLI options (single source of truth) ---

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit machine-parseable JSON to stdout"),
)

const debugOption = Options.boolean("debug").pipe(
  Options.withDefault(false),
  Options.withDescription("Enable verbose logging to stderr"),
)

const nonInteractiveOption = Options.boolean("non-interactive").pipe(
  Options.withDefault(false),
  Options.withDescription(
    "Auto-confirm dangerous operations; fail when input is missing",
  ),
)

const networkOption = Options.text("network").pipe(
  Options.withDefault("testnet"),
  Options.withDescription("Override the network for this command"),
)

const accountOption = Options.text("account").pipe(
  Options.optional,
  Options.withDescription("Use the named account for signing operations"),
)

const passwordOption = Options.text("password").pipe(
  Options.optional,
  Options.withDescription("Keystore password for decrypting the account key"),
)

/** Options config for the root command. */
export const rootOptions = {
  json: jsonOption,
  debug: debugOption,
  nonInteractive: nonInteractiveOption,
  network: networkOption,
  account: accountOption,
  password: passwordOption,
} as const

// --- CliConfig service ---

export interface CliConfigShape {
  readonly json: boolean
  readonly debug: boolean
  readonly nonInteractive: boolean
  readonly network: string
  readonly account: Option.Option<string>
  readonly password: Option.Option<string>
}

export class CliConfig extends Context.Tag("CliConfig")<
  CliConfig,
  CliConfigShape
>() {}

export const makeCliConfigLayer = (
  config: CliConfigShape,
): Layer.Layer<CliConfig> => Layer.succeed(CliConfig, config)

/** Pipe onto the root command to inject CliConfig from parsed options. */
export const provideCliConfig = Command.provideSync(
  CliConfig,
  (parsed: Command.Command.ParseConfig<typeof rootOptions>) => ({
    json: parsed.json,
    debug: parsed.debug,
    nonInteractive: parsed.nonInteractive || parsed.json,
    network: parsed.network,
    account: parsed.account,
    password: parsed.password,
  }),
)
