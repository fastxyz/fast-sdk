import { isCancel, PasswordPrompt } from "@clack/core";
import { Context, Effect, Layer, Option } from "effect";
import { PasswordRequiredError, UserCancelledError } from "../errors/index.js";
import { Config, type ConfigShape } from "./cli-config.js";

type PasswordResolveEffect = Effect.Effect<
  string,
  PasswordRequiredError | UserCancelledError
>;

export interface PasswordShape {
  readonly resolve: () => PasswordResolveEffect;
}

export class Password extends Context.Tag("Password")<
  Password,
  PasswordShape
>() {}

const createPrompter = (label: string) => {
  return new PasswordPrompt({
    mask: "*",
    output: process.stderr,
    render() {
      if (this.state === "cancel") return `${label}`;
      return `${label} ${this.masked}`;
    },
  });
};

const promptPassword = (label: string) => {
  const prompter = createPrompter(label);
  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.flatMap((value) =>
      isCancel(value) || value === undefined
        ? Effect.fail(new UserCancelledError())
        : Effect.succeed(value),
    ),
  );
};

const passwordResolve = (config: ConfigShape): PasswordResolveEffect => {
  if (Option.isSome(config.password)) {
    return Effect.succeed(config.password.value);
  }

  const envPassword = process.env.FAST_PASSWORD;
  if (envPassword !== undefined) {
    return Effect.succeed(envPassword);
  }

  if (config.nonInteractive) {
    return Effect.fail(new PasswordRequiredError());
  }

  return promptPassword("Password:");
};

export const PasswordLive = Layer.effect(
  Password,
  Effect.gen(function* () {
    const config = yield* Config;

    return {
      resolve: () => passwordResolve(config),
    };
  }),
);
