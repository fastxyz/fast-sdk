import { Context, Layer, type Option } from "effect";

export interface ClientConfigShape {
  readonly json: boolean;
  readonly debug: boolean;
  readonly nonInteractive: boolean;
  readonly network: string;
  readonly account: Option.Option<string>;
  readonly password: Option.Option<string>;
}

export class ClientConfig extends Context.Tag("ClientConfig")<
  ClientConfig,
  ClientConfigShape
>() {}

export const makeClientConfigLayer = (
  config: ClientConfigShape,
): Layer.Layer<ClientConfig> => Layer.succeed(ClientConfig, config);
