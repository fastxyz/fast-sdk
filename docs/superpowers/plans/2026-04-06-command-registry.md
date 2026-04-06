<!-- markdownlint-disable MD013 -->
# Command Registry + No Raw Argv Parsing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the handler registry in main.ts with per-file command definitions, switch from `runParserSync` to `parse()` for full error control, and eliminate all raw `process.argv` parsing.

**Architecture:** Each command file exports a `{ cmd, handler }` object. A `commands/index.ts` barrel collects them into an array. `main.ts` does a two-pass parse: first pass extracts global flags (to know `--json` without raw argv), second pass parses the full command tree. Help/version handled manually (~10 lines). Dispatch via array lookup.

**Tech Stack:** TypeScript, @optique/core, Effect 3.x.

---

## File structure

**Created:**

- `app/cli/src/commands/index.ts` — barrel that imports and re-exports all commands as an array

**Modified:**

- `app/cli/src/main.ts` — two-pass parse, manual help/version, array lookup dispatch
- `app/cli/src/cli.ts` — export `globalOptions` parser (for the first pass)
- All 16 command files — export `{ cmd, handler }` object instead of bare handler function

---

## Task 1: Export `globalOptions` from cli.ts

**Files:** Modify `app/cli/src/cli.ts`

The `globalOptions` parser is currently `const` (not exported). It needs to be exported so `main.ts` can use it for the first-pass parse.

- [ ] **Step 1.1: Export `globalOptions`**

In `app/cli/src/cli.ts`, change:

```typescript
const globalOptions = object({
```

to:

```typescript
export const globalOptions = object({
```

That's the only change — one word added.

- [ ] **Step 1.2: Commit**

```bash
git add app/cli/src/cli.ts
git commit -m "refactor(fast-cli): export globalOptions parser for two-pass parsing"
```

---

## Task 2: Update all 16 command files to export `{ cmd, handler }`

**Files:** Modify all 16 leaf command files

Each file currently exports a bare handler function:

```typescript
export const accountListHandler = (_args: AccountListArgs) =>
  Effect.gen(function* () { ... });
```

Change each to export a command definition object:

```typescript
import type { CommandName, AccountListArgs } from "../../cli.js";

export const accountList = {
  cmd: "account-list" as CommandName,
  handler: (_args: AccountListArgs) =>
    Effect.gen(function* () { ... }),
};
```

The `CommandName` type import ensures the `cmd` string matches the discriminated union. The handler body stays IDENTICAL — only the export wrapper changes.

- [ ] **Step 2.1: Update account commands (7 files)**

For each file in `app/cli/src/commands/account/`:

| File | Old export | New export |
| --- | --- | --- |
| `create.ts` | `accountCreateHandler` | `accountCreate = { cmd: "account-create", handler: ... }` |
| `delete.ts` | `accountDeleteHandler` | `accountDelete = { cmd: "account-delete", handler: ... }` |
| `export.ts` | `accountExportHandler` | `accountExport = { cmd: "account-export", handler: ... }` |
| `import.ts` | `accountImportHandler` | `accountImport = { cmd: "account-import", handler: ... }` |
| `info.ts` | `accountInfoHandler` | `accountInfo = { cmd: "account-info", handler: ... }` |
| `list.ts` | `accountListHandler` | `accountList = { cmd: "account-list", handler: ... }` |
| `set-default.ts` | `accountSetDefaultHandler` | `accountSetDefault = { cmd: "account-set-default", handler: ... }` |

Example transformation for `list.ts`:

```typescript
// Before
import type { AccountListArgs } from "../../cli.js";

export const accountListHandler = (_args: AccountListArgs) =>
  Effect.gen(function* () { ... });

// After
import type { AccountListArgs, CommandName } from "../../cli.js";

export const accountList = {
  cmd: "account-list" as CommandName,
  handler: (_args: AccountListArgs) =>
    Effect.gen(function* () { ... }),
};
```

- [ ] **Step 2.2: Update network commands (4 files)**

| File | New export |
| --- | --- |
| `list.ts` | `networkList = { cmd: "network-list", handler: ... }` |
| `add.ts` | `networkAdd = { cmd: "network-add", handler: ... }` |
| `set-default.ts` | `networkSetDefault = { cmd: "network-set-default", handler: ... }` |
| `remove.ts` | `networkRemove = { cmd: "network-remove", handler: ... }` |

- [ ] **Step 2.3: Update info commands (4 files)**

| File | New export |
| --- | --- |
| `status.ts` | `infoStatus = { cmd: "info-status", handler: ... }` |
| `balance.ts` | `infoBalance = { cmd: "info-balance", handler: ... }` |
| `tx.ts` | `infoTx = { cmd: "info-tx", handler: ... }` |
| `history.ts` | `infoHistory = { cmd: "info-history", handler: ... }` |

- [ ] **Step 2.4: Update send command (1 file)**

```typescript
export const send = {
  cmd: "send" as CommandName,
  handler: (args: SendArgs) => Effect.gen(function* () { ... }),
};
```

- [ ] **Step 2.5: Commit**

```bash
git add app/cli/src/commands/
git commit -m "refactor(fast-cli): export { cmd, handler } from all command files"
```

---

## Task 3: Create `commands/index.ts` barrel

**Files:** Create `app/cli/src/commands/index.ts`

- [ ] **Step 3.1: Create the barrel file**

```typescript
import { accountCreate } from "./account/create.js";
import { accountDelete } from "./account/delete.js";
import { accountExport } from "./account/export.js";
import { accountImport } from "./account/import.js";
import { accountInfo } from "./account/info.js";
import { accountList } from "./account/list.js";
import { accountSetDefault } from "./account/set-default.js";
import { infoBalance } from "./info/balance.js";
import { infoHistory } from "./info/history.js";
import { infoStatus } from "./info/status.js";
import { infoTx } from "./info/tx.js";
import { networkAdd } from "./network/add.js";
import { networkList } from "./network/list.js";
import { networkRemove } from "./network/remove.js";
import { networkSetDefault } from "./network/set-default.js";
import { send } from "./send.js";

export const commands = [
  accountCreate,
  accountDelete,
  accountExport,
  accountImport,
  accountInfo,
  accountList,
  accountSetDefault,
  infoBalance,
  infoHistory,
  infoStatus,
  infoTx,
  networkAdd,
  networkList,
  networkRemove,
  networkSetDefault,
  send,
] as const;
```

Adding a new command = export `{ cmd, handler }` from the file + add one import + one array entry here.

- [ ] **Step 3.2: Commit**

```bash
git add app/cli/src/commands/index.ts
git commit -m "feat(fast-cli): add commands barrel for auto-dispatch"
```

---

## Task 4: Rewrite main.ts — two-pass parse + array dispatch

**Files:** Rewrite `app/cli/src/main.ts`

This is the core change. Replace `runParserSync` with `parse()`, add a first pass for global flags, and dispatch via the commands array.

- [ ] **Step 4.1: Rewrite `app/cli/src/main.ts`**

The implementer should also export a **lenient pre-parser** from `cli.ts` that uses `passThrough` to absorb unknown tokens. This ensures the first pass ALWAYS succeeds:

```typescript
// In cli.ts — add this export alongside globalOptions
export const globalPreParser = object({
  json: withDefault(option("--json"), false),
  help: withDefault(option("--help"), false),
  version: withDefault(option("--version"), false),
  _rest: passThrough({ format: "greedy" }),
});
```

Import `passThrough` from `@optique/core/primitives`.

Then `main.ts`:

```typescript
/**
 * Unified CLI entrypoint.
 *
 * Two-pass parse: first lenient pass extracts global flags (--json, --help,
 * --version) via a parser with passThrough. Second pass parses the full
 * command tree. ZERO raw argv parsing — all flag detection goes through optique.
 */

import { formatDocPage } from "@optique/core/doc";
import { formatMessage } from "@optique/core/message";
import { getDocPageSync, parse } from "@optique/core/parser";
import { Option } from "effect";

import { type GlobalOptions, runHandler } from "./app.js";
import { globalPreParser, parser } from "./cli.js";
import { commands } from "./commands/index.js";
import { InternalError, InvalidUsageError } from "./errors/index.js";
import { writeFail } from "./services/output.js";

const VERSION = "0.1.0";
const argv = process.argv.slice(2);

// ---------------------------------------------------------------------------
// Pass 1: lenient parse — extract --json, --help, --version
// Always succeeds thanks to passThrough absorbing unknown tokens.
// ---------------------------------------------------------------------------
const pre = parse(globalPreParser, argv);
// pre.success is always true because all flags have defaults + passThrough
const isJson = pre.success && pre.value.json;
const isHelp = argv.length === 0 || (pre.success && pre.value.help);
const isVersion = pre.success && pre.value.version;

// ---------------------------------------------------------------------------
// --version
// ---------------------------------------------------------------------------
if (isVersion) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------
if (isHelp) {
  const docPage = getDocPageSync(parser);
  if (docPage) {
    process.stdout.write(
      `${formatDocPage("fast", docPage, { colors: process.stdout.isTTY ?? false })}\n`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Pass 2: parse full command tree
// ---------------------------------------------------------------------------
const result = parse(parser, argv);

if (!result.success) {
  writeFail(
    new InvalidUsageError({ message: formatMessage(result.error) }),
    isJson,
  );
  process.exit(1);
}

const parsed = result.value;

// ---------------------------------------------------------------------------
// Build GlobalOptions
// ---------------------------------------------------------------------------
const globalOpts: GlobalOptions = {
  json: parsed.json,
  debug: parsed.debug,
  nonInteractive: parsed.nonInteractive,
  network: parsed.network,
  account: parsed.account != null ? Option.some(parsed.account) : Option.none(),
  password:
    parsed.password != null ? Option.some(parsed.password) : Option.none(),
};

// ---------------------------------------------------------------------------
// Dispatch via command registry
// ---------------------------------------------------------------------------
const entry = commands.find((c) => c.cmd === parsed.cmd);
if (!entry) {
  writeFail(
    new InternalError({ message: `Unknown command: ${parsed.cmd}` }),
    isJson,
  );
  process.exit(1);
}

runHandler(globalOpts, entry.handler(parsed)).catch((err: unknown) => {
  writeFail(
    new InternalError({
      message: err instanceof Error ? err.message : String(err),
      cause: err,
    }),
    isJson,
  );
  process.exit(1);
});
```

**Key changes from current:**

- `runParserSync` → `parse()` (two calls — lenient pre-parse + full parse)
- `rawArgs.includes("--json")` → `pre.value.json` (parsed via optique, not raw)
- `argv.includes("--help")` → `pre.value.help` (parsed via optique)
- `argv.includes("--version")` → `pre.value.version` (parsed via optique)
- 16-entry handler registry → `commands.find(c => c.cmd === parsed.cmd)`
- No `CommandName` type or `Handler` type needed — the commands array is the source of truth
- `argv.length === 0` is the ONLY raw check — it detects "user typed nothing" which no parser can detect

**ZERO `.includes()` calls on argv. All flag detection goes through optique.**

- [ ] **Step 4.2: Build + smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
rm -rf ~/.fast
node app/cli/dist/main.js --help | head -10
node app/cli/dist/main.js --version
node app/cli/dist/main.js network list --json | head -3
node app/cli/dist/main.js account create --name barrel-test --password testpw --non-interactive --json | head -3
node app/cli/dist/main.js account delete barrel-test --non-interactive --json | head -3
node app/cli/dist/main.js send --json 2>&1 | head -5
echo "EXIT=$?"
```

Expected:

- Build success
- `--help` shows full usage with descriptions
- `--version` shows `0.1.0`
- All commands work
- `send --json` with missing args shows JSON error with `INVALID_USAGE` (not raw text)

- [ ] **Step 4.3: Commit**

```bash
git add app/cli/src/main.ts
git commit -m "refactor(fast-cli): two-pass parse + command array dispatch, no raw argv"
```

---

## Task 5: Verification

- [ ] **Step 5.1: No raw argv parsing**

```bash
grep -n "rawArgs\|process\.argv" app/cli/src/main.ts
```

Expected: only `process.argv.slice(2)` on one line. No `rawArgs.includes("--json")`.

- [ ] **Step 5.2: No handler registry in main.ts**

```bash
grep -n "import.*Handler\|handlers\[" app/cli/src/main.ts || echo "no handler registry"
```

Expected: "no handler registry".

- [ ] **Step 5.3: Commands barrel exists**

```bash
cat app/cli/src/commands/index.ts | head -5
```

- [ ] **Step 5.4: All command files export `{ cmd, handler }`**

```bash
grep -rn "export const.*= {" app/cli/src/commands/ | grep -v "index.ts" | wc -l
```

Expected: 16.

- [ ] **Step 5.5: Build + full lifecycle**

```bash
pnpm -F @fastxyz/fast-cli build
rm -rf ~/.fast
node app/cli/dist/main.js --version
node app/cli/dist/main.js account create --name verify --password pw --non-interactive --json
node app/cli/dist/main.js account list --json
node app/cli/dist/main.js account delete verify --non-interactive --json
node app/cli/dist/main.js info status --json
node app/cli/dist/main.js info tx 0xDEADBEEF --json ; echo "EXIT=$?"
FAST_PASSWORD=pw node app/cli/dist/main.js account create --name env-test --non-interactive --json
node app/cli/dist/main.js account delete env-test --non-interactive --json
```
