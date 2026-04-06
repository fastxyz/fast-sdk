import { Context, Layer, type Option } from "effect";

export interface ConfigShape {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export class Config extends Context.Tag("Config")<Config, ConfigShape>() {}

export const makeConfigLayer = (config: ConfigShape): Layer.Layer<Config> =>
  Layer.succeed(Config, config);
