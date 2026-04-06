import { ConfirmPrompt, isCancel, PasswordPrompt } from "@clack/core";
import { Context, Effect, Layer, Option } from "effect";
import { PasswordRequiredError, UserCancelledError } from "../errors/index.js";
import { Config, type ConfigShape } from "./cli-config.js";

export interface PromptShape {
  readonly password: () => Effect.Effect<
    string,
    PasswordRequiredError | UserCancelledError
  >;
  readonly confirm: (message: string) => Effect.Effect<boolean>;
}

export class Prompt extends Context.Tag("Prompt")<Prompt, PromptShape>() {}

const promptPassword = (label: string) =>
  Effect.promise(() =>
    new PasswordPrompt({
      mask: "*",
      output: process.stderr,
      render() {
        if (this.state === "cancel") return `${label}`;
        return `${label} ${this.masked}`;
      },
    }).prompt(),
  ).pipe(
    Effect.flatMap((value) =>
      isCancel(value) || value === undefined
        ? Effect.fail(new UserCancelledError())
        : Effect.succeed(value),
    ),
  );

const passwordResolve = (
  config: ConfigShape,
): Effect.Effect<string, PasswordRequiredError | UserCancelledError> => {
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

const confirmPrompt = (
  config: ConfigShape,
  message: string,
): Effect.Effect<boolean> => {
  if (config.nonInteractive || config.json) return Effect.succeed(true);

  return Effect.promise(() =>
    new ConfirmPrompt({
      active: "Yes",
      inactive: "No",
      initialValue: false,
      render() {
        if (this.state === "cancel") return `${message} No`;
        if (this.state === "submit")
          return `${message} ${this.value ? "Yes" : "No"}`;
        return `${message} (y/N)`;
      },
    }).prompt(),
  ).pipe(Effect.map((value) => !isCancel(value) && value === true));
};

export const PromptLive = Layer.effect(
  Prompt,
  Effect.gen(function* () {
    const config = yield* Config;

    return {
      password: () => passwordResolve(config),
      confirm: (message) => confirmPrompt(config, message),
    };
  }),
);
