import { ConfirmPrompt, isCancel, PasswordPrompt } from "@clack/core";
import { Context, Effect, Layer, Option } from "effect";
import { PasswordRequiredError, UserCancelledError } from "../errors/index.js";
import { ClientConfig, type ClientConfigShape } from "./config/client.js";

type ConfirmEffect = Effect.Effect<boolean, UserCancelledError>;
type PasswordEffect = Effect.Effect<
  string,
  PasswordRequiredError | UserCancelledError
>;
type OptionalPasswordEffect = Effect.Effect<
  Option.Option<string>,
  UserCancelledError
>;

export interface PromptShape {
  readonly password: {
    (): PasswordEffect;
    (opts: { required: false }): OptionalPasswordEffect;
  };
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

const passwordPrompt = (config: ClientConfigShape, label: string): PasswordEffect => {
  if (Option.isSome(config.password)) {
    return Effect.succeed(config.password.value);
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

const optionalPasswordPrompt = (
  config: ClientConfigShape,
  label: string,
): OptionalPasswordEffect => {
  if (Option.isSome(config.password)) {
    return Effect.succeed(Option.some(config.password.value));
  }
  if (config.nonInteractive) {
    return Effect.succeed(Option.none());
  }
  const prompter = createPasswordPrompter(label);
  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.flatMap((value) => {
      if (isCancel(value)) {
        return Effect.fail(new UserCancelledError());
      }
      return Effect.succeed(
        value === "" || value === undefined ? Option.none() : Option.some(value),
      );
    }),
  );
};

const createConfirmPrompter = (message: string) => {
  return new ConfirmPrompt({
    active: "y",
    inactive: "n",
    initialValue: false,
    render() {
      let suffix = "(y/N)";
      if (this.state === "cancel") suffix = "(cancelled)";
      if (this.state === "submit") suffix = this.value ? "(y)" : "(n)";
      return `${message} ${suffix}`;
    },
  });
};

const confirmPrompt = (config: ClientConfigShape, message: string): ConfirmEffect => {
  if (config.nonInteractive) return Effect.succeed(true);

  const prompter = createConfirmPrompter(message);

  return Effect.promise(() => prompter.prompt()).pipe(
    Effect.flatMap((value) =>
      isCancel(value)
        ? Effect.fail(new UserCancelledError())
        : Effect.succeed(value === true),
    ),
  );
};

export const PromptLive = Layer.effect(
  Prompt,
  Effect.gen(function* () {
    const config = yield* ClientConfig;

    return {
      password: ((opts?: { required: false }) => {
        if (opts?.required === false) {
          return optionalPasswordPrompt(config, "Password (Enter to skip):");
        }
        return passwordPrompt(config, "Password:");
      }) as PromptShape["password"],
      confirm: (message) => confirmPrompt(config, message),
    };
  }),
);
