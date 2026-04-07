<!-- markdownlint-disable MD013 -->
# Prompt Service: Merge password + confirm

## Goal

Merge `password.ts` and `prompt.ts` into a single `Prompt` Effect service with two methods: `password()` and `confirm(message)`.

## Context

The CLI has two user-input concerns split across two files:

- `services/password.ts` — an Effect service (`Password` tag) with a `resolve()` method that checks `--password` flag > `FAST_PASSWORD` env > interactive prompt > `PasswordRequiredError`
- `services/prompt.ts` — a standalone `confirm()` function that auto-confirms in non-interactive mode or shows an inline `(y/N)` prompt

Both use `@clack/core` for the interactive prompt, both depend on `ConfigShape` for non-interactive detection, and both follow the same pattern (check config → fall back to interactive). They belong together.

## Design

### Service interface

```typescript
export interface PromptShape {
  readonly password: () => Effect.Effect<string, PasswordRequiredError | UserCancelledError>;
  readonly confirm: (message: string) => Effect.Effect<boolean>;
}

export class Prompt extends Context.Tag("Prompt")<Prompt, PromptShape>() {}
```

### `password()` behavior (unchanged from current)

1. If `--password` flag provided → return it
2. If `FAST_PASSWORD` env var set → return it
3. If non-interactive mode → fail with `PasswordRequiredError`
4. Otherwise → show inline masked prompt via `@clack/core` `PasswordPrompt`
5. On Ctrl+C → fail with `UserCancelledError`

### `confirm(message)` behavior (unchanged from current)

1. If non-interactive or json mode → return `true` (auto-confirm)
2. Otherwise → show inline `message (y/N)` prompt via `@clack/core` `ConfirmPrompt`
3. On Ctrl+C → return `false`

### Layer

```typescript
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
```

## File changes

| File | Change |
| --- | --- |
| `app/cli/src/services/prompt.ts` | **REWRITE** — becomes the merged Prompt service with both methods |
| `app/cli/src/services/password.ts` | **DELETE** |
| `app/cli/src/layers.ts` | `PasswordLive` → `PromptLive` |
| `app/cli/src/commands/account/create.ts` | `Password` → `Prompt`, `.resolve()` → `.password()` |
| `app/cli/src/commands/account/import.ts` | same |
| `app/cli/src/commands/account/export.ts` | merge `Password` + `confirm` imports into single `Prompt` import |
| `app/cli/src/commands/account/delete.ts` | `confirm(config, msg)` → `prompt.confirm(msg)` |
| `app/cli/src/commands/send.ts` | merge `Password` + `confirm` imports into single `Prompt` import |

## Caller pattern after

```typescript
const prompt = yield* Prompt;

// password
const pwd = yield* prompt.password();

// confirm
const confirmed = yield* prompt.confirm("Delete account?");
if (!confirmed) return yield* Effect.fail(new UserCancelledError());
```

No more `yield* Config` in commands that only needed it for the confirm check — the Prompt service owns that dependency.
