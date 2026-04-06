import { Context, Layer, Option } from "effect";

export interface EnvShape {
  readonly fastPassword: Option.Option<string>;
}

export class Env extends Context.Tag("Env")<Env, EnvShape>() {}

export const EnvLive = Layer.sync(Env, () => ({
  fastPassword: Option.fromNullable(process.env.FAST_PASSWORD),
}));
