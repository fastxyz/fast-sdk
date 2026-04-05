import { Context, Layer, type Option } from "effect";

// --- CliConfig service ---

export interface CliConfigShape {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export class CliConfig extends Context.Tag("CliConfig")<
  CliConfig,
  CliConfigShape
>() {}

export const makeCliConfigLayer = (
  config: CliConfigShape,
): Layer.Layer<CliConfig> => Layer.succeed(CliConfig, config);
