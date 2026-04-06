import { Context, Layer } from "effect";

export interface EnvShape {
  readonly fastPassword: string | undefined;
}

export class Env extends Context.Tag("Env")<Env, EnvShape>() {}

export const EnvLive = Layer.sync(Env, () => ({
  fastPassword: process.env.FAST_PASSWORD,
}));
