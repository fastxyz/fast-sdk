<!-- markdownlint-disable MD013 -->
# Bootstrap Redesign: Migrate to @optique/core

## Goal

Replace citty with `@optique/core` for CLI parsing. Unify the three ad-hoc error handling paths into one. Consolidate 5 bootstrap files into 3. Integrate env var binding into the parser (eliminating the Env service).

## Problems solved

1. **Three error handling paths → one.** `main.ts` catches citty errors, `cli-runner.ts` catches Effect errors, `cli-runner.ts` catches defects. All format errors independently. Should be one path through `Output.fail`.
2. **Per-subcommand help on error.** When `fast send` gets bad args, show `fast send --help`, not root help. citty's `resolveSubCommand` is internal-only. optique's `parse()` returns structured errors with context.
3. **Five bootstrap files → three.** `cli-globals.ts`, `cli-runner.ts`, `layers.ts`, `cli.ts`, `main.ts` consolidate into `main.ts`, `cli.ts`, `app.ts`.
4. **Env var binding.** `FAST_PASSWORD` currently lives in a separate `Env` service read at runtime. optique can bind `--password` flag to `FAST_PASSWORD` env in one declaration.
5. **No integer type in citty.** We added manual NaN validation for `--limit`/`--offset`. optique has `integer()` natively.
6. **Global args not inherited.** citty requires `...globalArgs` spread into every leaf command. optique's `object()` composability handles shared options naturally.
7. **`cli-globals.ts` reads `~/.fast/networks.json` at module load.** Stale — we use SQLite now. With optique, `--network` just defaults to `"testnet"` and the NetworkConfigService resolves later.

## Why @optique/core

- `parse()` returns `{ success: true, value } | { success: false, error }` — **never calls `process.exit`**
- Discriminated union results give full error control
- Per-subcommand error context (the error knows which command failed)
- Built-in env var binding (flag > env > default)
- Native `integer()`, `string()`, `boolean()` value parsers — no manual validation
- Best-in-class TypeScript inference from parser combinators
- Zero runtime dependencies in core
- Active maintenance (0.10.x as of March 2026)

## Architecture

### Files after

| File | Role |
| --- | --- |
| `main.ts` | Entrypoint: parse argv with optique, dispatch to handler, unified error handler |
| `cli.ts` | Parser definitions: all commands, subcommands, global args, env bindings |
| `app.ts` | Layer wiring (`makeAppLayer`) + `runHandler` (Effect runner) |

**Deleted:** `cli-globals.ts`, `cli-runner.ts`, `layers.ts`

### Parse → Run → Error flow

```text
main.ts: parse(parser, argv)
  ├─ { success: false } → format error + show subcommand help → exit
  └─ { success: true, value } → match command → runHandler(value, effectProgram)
       ├─ CliError → Output.fail(err) → exit(code)
       └─ defect   → Output.fail(err) → exit(1)
```

One error handler in `main.ts`. No catch blocks in multiple files. Parse errors and Effect errors both flow to the same formatting logic.

### Parser structure (cli.ts)

```typescript
import { object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { argument, command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

// Global options shared by all commands
const globalOpts = {
  json: option("--json"),
  debug: option("--debug"),
  nonInteractive: option("--non-interactive"),
  network: optional(option("--network", string()), { default: "testnet" }),
  account: optional(option("--account", string())),
  password: optional(option("--password", string())),
  // env binding: --password flag > FAST_PASSWORD env > undefined
};

// Example subcommand
const sendParser = command("send", object({
  cmd: constant("send"),
  ...globalOpts,
  address: argument(string({ metavar: "ADDRESS" })),
  amount: argument(string({ metavar: "AMOUNT" })),
  token: optional(option("--token", string())),
  fromChain: optional(option("--from-chain", string())),
  toChain: optional(option("--to-chain", string())),
}));

// Root parser
export const parser = or(
  command("account", accountCommands),
  command("network", networkCommands),
  command("info", infoCommands),
  sendParser,
);
```

The discriminated union (`cmd: constant("send")`) gives type-safe dispatch in the handler.

### Output service rename

```typescript
output.success(data)  →  output.ok(data)
output.error(err)     →  output.fail(err)
```

### Env service elimination

The `Env` service (`env.ts`) is deleted. `FAST_PASSWORD` is read by optique's parser via env var binding. The parsed value flows into the Config layer as `password: Option<string>` — same as today, but the parser handles the env fallback instead of a separate service.

## Dependencies

**Added:**

- `@optique/core` — parser combinators + value parsers
- `@optique/run` (optional) — only if we want their `run()` utility; otherwise we use `parse()` from core directly

**Removed:**

- `citty`

**Kept:** everything else (Effect, better-sqlite3, drizzle-orm, @clack/core, cli-table3, @noble/*)

## What changes

| File | Change |
| --- | --- |
| `app/cli/src/main.ts` | Rewrite: parse + dispatch + unified error handler |
| `app/cli/src/cli.ts` | Rewrite: optique parser definitions for all commands |
| `app/cli/src/app.ts` | New: merge of layers.ts + cli-runner.ts (layer wiring + runHandler) |
| `app/cli/src/services/output.ts` | Rename: `success` → `ok`, `error` → `fail` |
| `app/cli/src/services/env.ts` | Delete (env binding moves into parser) |
| `app/cli/src/services/prompt.ts` | Remove Env dependency; password from env comes via parsed args |
| `app/cli/src/layers.ts` | Delete (merged into app.ts) |
| `app/cli/src/cli-globals.ts` | Delete (merged into cli.ts) |
| `app/cli/src/cli-runner.ts` | Delete (merged into app.ts) |
| All command files | Update: import from `../app.js` instead of `../cli-runner.js`; `output.ok`/`output.fail` instead of `output.success`/`output.error` |

## What stays unchanged

- All service files (account-store, history-store, network-config, database, crypto, fast-rpc, token-resolver)
- Error types and mappings
- Schemas
- Config service (still receives parsed options from the runner)

## Migration approach

This is a full rewrite of the CLI's bootstrap layer (parser + runner + error handling). The service layer and command handler bodies stay the same — only the wrapper around each command changes. The commands currently look like:

```typescript
// Before (citty)
export const accountList = defineCommand({
  meta: { name: 'list', description: 'List all accounts' },
  args: { ...globalArgs },
  run: ({ args }) => runHandler(args, Effect.gen(function* () { ... })),
});
```

After:

```typescript
// After (optique) — handler body unchanged, wrapper different
// The command is defined in cli.ts as a parser
// The handler is defined in the command file as an Effect program
// main.ts connects them
export const accountListHandler = Effect.gen(function* () { ... });
```

The exact command file structure depends on how we want to organize the parser↔handler binding — that's an implementation detail for the plan.
