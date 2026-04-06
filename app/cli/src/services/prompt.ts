import { ConfirmPrompt, isCancel, PasswordPrompt } from "@clack/core";
import { Context, Effect, Layer, Option } from "effect";
import { PasswordRequiredError, UserCancelledError } from "../errors/index.js";
import { Config, type ConfigShape } from "./cli-config.js";

type ConfirmEffect = Effect.Effect<boolean>;
type PasswordEffect = Effect.Effect<
  string,
  PasswordRequiredError | UserCancelledError
>;

export interface PromptShape {
  readonly password: () => PasswordEffect;
  readonly confirm: (message: string) => ConfirmEffect;
}

export class Prompt extends Context.Tag("Prompt")<Prompt, PromptShape>() {}

const createPasswordPrompter = (label: string) => {
  return new PasswordPrompt({
    mask: "*",
    output: process.stderr,
    render() {
      if (this.state === "cancel") return `${label}`;
      return `${label} ${this.masked}`;
    },
  });
};

const passwordPrompt = (config: ConfigShape, label: string): PasswordEffect => {
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

  const prompter = createPasswordPrompter(label);
  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.flatMap((value) =>
      isCancel(value) || value === undefined
        ? Effect.fail(new UserCancelledError())
        : Effect.succeed(value),
    ),
  );
};

const createConfirmPrompter = (message: string) => {
  return new ConfirmPrompt({
    active: "Yes",
    inactive: "No",
    initialValue: false,
    render() {
      if (this.state === "cancel") return `${message} No`;
      if (this.state === "submit")
        return `${message} ${this.value ? "Yes" : "No"}`;
      return `${message} (y/N)`;
    },
  });
};

const confirmPrompt = (config: ConfigShape, message: string): ConfirmEffect => {
  if (config.nonInteractive) return Effect.succeed(true);

  const prompter = createConfirmPrompter(message);

  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.map((value) => !isCancel(value) && value === true),
  );
};

export const PromptLive = Layer.effect(
  Prompt,
  Effect.gen(function* () {
    const config = yield* Config;

    return {
      password: () => passwordPrompt(config, "Password:"),
      confirm: (message) => confirmPrompt(config, message),
    };
  }),
);
