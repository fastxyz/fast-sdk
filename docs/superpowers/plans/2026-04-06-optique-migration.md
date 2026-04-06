<!-- markdownlint-disable MD013 -->
# Optique Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace citty with `@optique/core` for CLI parsing, unify error handling into one path, consolidate 5 bootstrap files into 3, and rename Output methods to `ok`/`fail`.

**Architecture:** Parsers defined centrally in `cli.ts` using optique combinators. `app.ts` merges layer wiring + Effect runner. `main.ts` parses argv, dispatches to command handlers, and handles all errors (parse + Effect + defects) in one place. Command files export Effect programs that receive typed parsed args.

**Tech Stack:** TypeScript, Effect 3.x, @optique/core, better-sqlite3, drizzle-orm.

**Spec:** [docs/superpowers/specs/2026-04-06-optique-bootstrap-redesign.md](../specs/2026-04-06-optique-bootstrap-redesign.md)

---

## File structure

**Created:**

- `app/cli/src/app.ts` — layer wiring + `runHandler` (merge of `layers.ts` + `cli-runner.ts`)

**Rewritten:**

- `app/cli/src/main.ts` — unified entrypoint with optique `parse()` + error handling
- `app/cli/src/cli.ts` — optique parser definitions for all commands (replaces citty `defineCommand` + `globalArgs`)
- `app/cli/src/services/output.ts` — rename `success` → `ok`, `error` → `fail`
- All 19 command files — export Effect programs instead of citty `defineCommand` wrappers

**Deleted:**

- `app/cli/src/cli-globals.ts` (merged into `cli.ts`)
- `app/cli/src/cli-runner.ts` (merged into `app.ts`)
- `app/cli/src/layers.ts` (merged into `app.ts`)
- `app/cli/src/services/env.ts` (env binding moves into parser)

**Unchanged:** all service files, error types, schemas, db/, drizzle config.

---

## Design notes

### Command file pattern change

**Before (citty):** Each command file exports a citty `defineCommand` that wraps an Effect handler. The citty wrapper owns arg definitions, meta, and the `runHandler` call.

```typescript
// Before: account/list.ts
import { defineCommand } from "citty";
import { globalArgs } from "../../cli-globals.js";
import { runHandler } from "../../cli-runner.js";

export const accountList = defineCommand({
  meta: { name: "list", description: "List all accounts" },
  args: { ...globalArgs },
  run: ({ args }) => runHandler(args, Effect.gen(function* () {
    // handler body
  })),
});
```

**After (optique):** Each command file exports just the Effect program. Args are passed in as a parameter. Parser definitions live in `cli.ts`. The connection happens in `main.ts`.

```typescript
// After: account/list.ts
import { Effect } from "effect";

export const accountListHandler = (args: AccountListArgs) =>
  Effect.gen(function* () {
    // same handler body — unchanged
  });
```

The `AccountListArgs` type is inferred from the parser in `cli.ts` via `InferValue<typeof accountListParser>`.

### Arg type flow

```text
cli.ts: defines parsers → exports arg types via InferValue
command files: import arg types, export (args) => Effect handlers
main.ts: parse(parser, argv) → match command → runHandler(args, handler(args))
```

### How env var binding works

In `cli.ts`, the `--password` option binds to `FAST_PASSWORD`:

```typescript
password: optional(option("--password", string())),
// At parse time, if --password not provided, check env:
// withDefault(option("--password", string()), () => process.env.FAST_PASSWORD)
```

The `Env` service is deleted. The prompt service reads password from parsed args (already resolved by optique).

---

## Task 1: Dependencies

**Files:** Modify `app/cli/package.json`

- [ ] **Step 1.1: Install optique, remove citty**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli add @optique/core
pnpm -F @fastxyz/fast-cli remove citty
```

- [ ] **Step 1.2: Verify**

```bash
grep -E "optique|citty" app/cli/package.json
```

Expected: `@optique/core` in dependencies, no `citty`.

- [ ] **Step 1.3: Commit**

```bash
git add app/cli/package.json pnpm-lock.yaml
git commit -m "chore(fast-cli): add @optique/core, remove citty"
```

---

## Task 2: Create `cli.ts` — parser definitions

**Files:** Rewrite `app/cli/src/cli.ts`

This defines all parsers using optique's combinators. Each command becomes a `command()` + `object()` with typed args. Global options are a shared object spread into every leaf command.

**IMPORTANT:** Read the optique docs carefully. The key imports are:

- `@optique/core/constructs` — `object`, `or`
- `@optique/core/primitives` — `command`, `option`, `argument`, `constant`
- `@optique/core/modifiers` — `optional`, `withDefault`
- `@optique/core/valueparser` — `string`, `integer`
- `@optique/core/parser` — `parse`, `InferValue`

- [ ] **Step 2.1: Rewrite `app/cli/src/cli.ts`**

The implementer should:

1. Read all 19 command files to understand every arg/option/positional used
2. Read the optique docs (use context7 MCP tool with library ID `/dahlia/optique`) for: `command()`, `object()`, `or()`, `option()`, `argument()`, `constant()`, `optional()`, `withDefault()`, `string()`, `integer()`, `parse()`, `InferValue`, `formatMessage`, `formatDocPage`, `doc`
3. Define the full parser tree:
   - Root: `or(accountCmd, networkCmd, infoCmd, sendCmd)`
   - Each group: `command("account", or(createCmd, importCmd, listCmd, ...))`
   - Each leaf: `command("list", object({ cmd: constant("account-list"), ...globalOpts }))`
   - Use `constant("account-list")` as discriminant for type-safe dispatch
4. Export the root parser and all `InferValue` arg types
5. The `--password` option should use `withDefault` with `process.env.FAST_PASSWORD` as fallback
6. The `--network` option should default to `"testnet"`

Key command args to define (from current citty definitions):

| Command | Positionals | Options |
| --- | --- | --- |
| account create | — | `--name` (string, optional) |
| account import | — | `--name` (string, opt), `--private-key` (string, opt), `--key-file` (string, opt) |
| account list | — | (none) |
| account set-default | name (required) | — |
| account info | name (optional) | — |
| account export | name (optional) | — |
| account delete | name (required) | — |
| network list | — | — |
| network add | name (required positional) | `--config` (string, required) |
| network set-default | name (required positional) | — |
| network remove | name (required positional) | — |
| info status | — | — |
| info balance | — | `--address` (string, opt), `--token` (string, opt) |
| info tx | hash (required positional) | — |
| info history | — | `--from`, `--to`, `--token` (string, opt), `--limit` (int, default 20), `--offset` (int, default 0) |
| send | address (required pos), amount (required pos) | `--token`, `--from-chain`, `--to-chain` (string, opt) |

Global options on every leaf:

- `--json` (boolean flag, default false)
- `--debug` (boolean flag, default false)
- `--non-interactive` (boolean flag, default false)
- `--network` (string, default "testnet")
- `--account` (string, optional)
- `--password` (string, optional, env fallback FAST_PASSWORD)

- [ ] **Step 2.2: Verify build compiles cli.ts**

```bash
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
```

Build will fail because main.ts still imports citty. That's expected.

- [ ] **Step 2.3: Commit**

```bash
git add app/cli/src/cli.ts
git commit -m "feat(fast-cli): define optique parser tree for all commands"
```

---

## Task 3: Create `app.ts` — layer wiring + Effect runner

**Files:** Create `app/cli/src/app.ts`

Merge `layers.ts` (service wiring) + `cli-runner.ts` (Effect runner + error handling) into one file. The `runHandler` function takes parsed global args + an Effect program, builds the layer, runs it, and catches errors.

- [ ] **Step 3.1: Create `app/cli/src/app.ts`**

The implementer should:

1. Read current `layers.ts` and `cli-runner.ts`
2. Merge them into one file
3. The `runHandler` function:
   - Takes parsed args (the global options subset) + an Effect program
   - Builds the app layer via `makeAppLayer`
   - Runs the Effect with `catchAll` for CliError → `Output.fail` → `process.exit(code)`
   - `catchAllDefect` → `Output.fail` fallback → `process.exit(1)`
   - `Effect.provide(layer)` → `Effect.runPromise`
4. Export `runHandler` and `makeAppLayer`
5. The `ParsedOptions` / `GlobalArgsParsed` types merge into one type here
6. Remove the `Env` service from the layer — password env is resolved by the parser now

- [ ] **Step 3.2: Commit**

```bash
git add app/cli/src/app.ts
git commit -m "feat(fast-cli): create app.ts with unified layer + runner"
```

---

## Task 4: Rewrite `main.ts` — unified entrypoint

**Files:** Rewrite `app/cli/src/main.ts`

This becomes the single error handling point. It:

1. Parses argv with optique's `parse()`
2. On parse failure: format error + show help for the failed command + exit
3. On parse success: match the discriminant (`cmd` field) → call the right handler via `runHandler`

- [ ] **Step 4.1: Rewrite `app/cli/src/main.ts`**

The implementer should:

1. Read optique docs for `parse()`, `formatMessage()`, `formatDocPage()`, `doc()`
2. Call `parse(rootParser, process.argv.slice(2))`
3. On `result.success === false`:
   - Check if `--json` was in argv (raw check since parse failed)
   - If JSON: write `{"ok": false, "error": {"code": "INVALID_USAGE", "message": formatMessage(result.error)}}` to stdout
   - If not JSON: write help text via `formatDocPage()` + error message to stderr
   - Exit 1
4. On `result.success === true`:
   - Check for `--help` / `--version` (optique may handle these, check docs)
   - Switch on `result.value.cmd` discriminant:
     - `"account-list"` → import and call `accountListHandler(result.value)` via `runHandler`
     - `"account-create"` → import and call `accountCreateHandler(result.value)` via `runHandler`
     - etc. for all ~16 leaf commands
5. The `runHandler` call builds the layer and runs the Effect — its error handling is the second (and final) error path

- [ ] **Step 4.2: Commit**

```bash
git add app/cli/src/main.ts
git commit -m "feat(fast-cli): unified entrypoint with optique parse + error handling"
```

---

## Task 5: Update all command files

**Files:** Modify all 19 files under `app/cli/src/commands/`

Each command file changes from exporting a citty `defineCommand` to exporting an Effect handler function that takes typed args.

- [ ] **Step 5.1: Update account commands (8 files)**

For each file in `app/cli/src/commands/account/`:

1. Remove citty imports (`defineCommand`, `globalArgs`, `runHandler`)
2. Import the arg type from `../../cli.js` (e.g., `AccountListArgs`)
3. Change the export from `defineCommand({...})` to a function: `(args: AccountListArgs) => Effect.gen(function* () { ... })`
4. The handler body stays IDENTICAL — only the wrapper changes
5. Remove `app/cli/src/commands/account/index.ts` (no longer needed — citty's subcommand routing is gone; optique handles it in cli.ts)

- [ ] **Step 5.2: Update network commands (5 files)**

Same pattern. Remove `app/cli/src/commands/network/index.ts`.

- [ ] **Step 5.3: Update info commands (5 files)**

Same pattern. Remove `app/cli/src/commands/info/index.ts`.

- [ ] **Step 5.4: Update send command (1 file)**

Same pattern.

- [ ] **Step 5.5: Build + smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
rm -rf ~/.fast
node app/cli/dist/main.js --help
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name optique-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete optique-test --non-interactive --json
node app/cli/dist/main.js send --json 2>&1  # should show send-specific help + error
```

Expected:

- Build success
- `--help` shows usage with all commands
- All read-only commands return JSON
- Account lifecycle works
- `send --json` without args shows send's help + JSON error envelope

- [ ] **Step 5.6: Commit**

```bash
git add app/cli/src/commands/ app/cli/src/main.ts
git commit -m "refactor(fast-cli): update all command files to optique handler pattern"
```

---

## Task 6: Output rename + cleanup

**Files:** Modify `app/cli/src/services/output.ts`, delete old files

- [ ] **Step 6.1: Rename Output methods**

In `app/cli/src/services/output.ts`:

- `success` → `ok`
- `error` → `fail`

Update `OutputShape` interface and implementation.

- [ ] **Step 6.2: Update all callers**

Search and replace across all command files:

- `output.success(` → `output.ok(`
- `output.error(` → `output.fail(`

Also update `app.ts` where `Output.fail` is used in the error handler.

```bash
grep -rn "output\.success\|output\.error" app/cli/src/ | grep -v "node_modules"
```

Fix each occurrence.

- [ ] **Step 6.3: Delete old files**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
rm app/cli/src/cli-globals.ts
rm app/cli/src/cli-runner.ts
rm app/cli/src/layers.ts
rm app/cli/src/services/env.ts
rm app/cli/src/commands/account/index.ts
rm app/cli/src/commands/network/index.ts
rm app/cli/src/commands/info/index.ts
```

- [ ] **Step 6.4: Remove `@clack/prompts` if no longer imported**

```bash
grep -rn "@clack/prompts" app/cli/src/ || pnpm -F @fastxyz/fast-cli remove @clack/prompts
```

- [ ] **Step 6.5: Update prompt.ts — remove Env dependency**

The `Prompt` service currently depends on `Env` for `FAST_PASSWORD`. Since the parser now handles env var binding, the password value comes through parsed args → Config → Prompt. Remove the `Env` import and `yield* Env` from `PromptLive`.

- [ ] **Step 6.6: Build + full smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -5
rm -rf ~/.fast

# Verify no stale imports
grep -rn "citty\|cli-globals\|cli-runner\|layers\.js\|env\.js" app/cli/src/ || echo "clean"

# Full lifecycle
node app/cli/dist/main.js --help
node app/cli/dist/main.js --version
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name final-test --password testpw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account export final-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete final-test --non-interactive --json
node app/cli/dist/main.js info status --json
node app/cli/dist/main.js info tx 0xDEADBEEF --json
node app/cli/dist/main.js send --json  # per-subcommand help + error

# Verify env var binding
FAST_PASSWORD=testpw node app/cli/dist/main.js account create --name env-test --non-interactive --json
node app/cli/dist/main.js account delete env-test --non-interactive --json
```

- [ ] **Step 6.7: Commit**

```bash
git add -A app/cli/src/
git rm app/cli/src/cli-globals.ts app/cli/src/cli-runner.ts app/cli/src/layers.ts app/cli/src/services/env.ts app/cli/src/commands/account/index.ts app/cli/src/commands/network/index.ts app/cli/src/commands/info/index.ts
git commit -m "refactor(fast-cli): rename Output ok/fail, delete old bootstrap files"
```

---

## Task 7: Final verification

**Files:** None modified.

- [ ] **Step 7.1: Verify file structure**

```bash
ls app/cli/src/*.ts
# Expected: main.ts, cli.ts, app.ts (no cli-globals, cli-runner, layers)

ls app/cli/src/services/
# Expected: NO env.ts

ls app/cli/src/commands/account/
# Expected: NO index.ts (same for network/, info/)
```

- [ ] **Step 7.2: Verify no stale references**

```bash
grep -rn "citty\|defineCommand\|globalArgs\|cli-globals\|cli-runner\|layers\.js\|output\.success\|output\.error\b" app/cli/src/ || echo "all clean"
```

Expected: "all clean" (no citty imports, no old file references, no old method names).

- [ ] **Step 7.3: Verify per-subcommand help on error**

```bash
node app/cli/dist/main.js send --json 2>&1
# Should show send's args (ADDRESS, AMOUNT) in help, NOT root help

node app/cli/dist/main.js account import --json 2>&1
# Should show import's args (--private-key, --key-file) in help
```

- [ ] **Step 7.4: Verify env var binding**

```bash
FAST_PASSWORD=testpw node app/cli/dist/main.js account create --name env-verify --non-interactive --json
echo $?  # Should be 0
node app/cli/dist/main.js account delete env-verify --non-interactive --json
```

- [ ] **Step 7.5: Commit list**

```bash
git log --oneline <start-sha>..HEAD
```

---

## Verification summary

The migration is complete when:

1. `grep -rn "citty" app/cli/src/ app/cli/package.json` returns zero matches
2. `ls app/cli/src/*.ts` shows only `main.ts`, `cli.ts`, `app.ts`
3. `pnpm -F @fastxyz/fast-cli build` succeeds
4. Account create → list → export → delete lifecycle works with `--json`
5. `FAST_PASSWORD=x` env var binding works (no Env service)
6. `fast send --json` (missing args) shows send-specific help + JSON error envelope
7. `output.ok` / `output.fail` are the only method names (no `success`/`error`)
8. No `cli-globals.ts`, `cli-runner.ts`, `layers.ts`, `env.ts`, or `*/index.ts` subcommand files remain
