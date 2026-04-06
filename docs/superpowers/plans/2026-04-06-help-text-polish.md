<!-- markdownlint-disable MD013 -->
# CLI Help Text Polish + Handler Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add descriptive metavars and descriptions to all CLI options/arguments (replace generic `STRING`), and replace the 16-case switch dispatch with a handler registry.

**Architecture:** Two independent changes: (1) enrich `cli.ts` parser definitions with `metavar` and `description` fields so `--help` output is agent-friendly, (2) collapse the `main.ts` switch into a `Record<CommandName, () => Promise<...>>` lookup with lazy imports.

**Tech Stack:** TypeScript, @optique/core.

---

## Task 1: Add metavars and descriptions to all options and arguments

**Files:** Modify `app/cli/src/cli.ts`

Every `string()`, `integer()`, `option()`, and `argument()` call needs:

- `metavar` on value parsers — replaces generic `STRING` in help with a descriptive name
- `description` on options/arguments — shows what the option does in help text

- [ ] **Step 1.1: Update global options with metavars + descriptions**

Change the `globalOptions` object. For each option, add `{ description: message\`...\` }` as an options arg, and `{ metavar: "..." }` on the value parser.

```typescript
const globalOptions = object({
  json: withDefault(
    option("--json", { description: message`Emit machine-parseable JSON to stdout` }),
    false,
  ),
  debug: withDefault(
    option("--debug", { description: message`Enable verbose logging to stderr` }),
    false,
  ),
  nonInteractive: withDefault(
    option("--non-interactive", {
      description: message`Auto-confirm dangerous operations; fail when input is missing`,
    }),
    false,
  ),
  network: withDefault(
    option("--network", string({ metavar: "NAME" }), {
      description: message`Override the network for this command`,
    }),
    "testnet",
  ),
  account: optional(
    option("--account", string({ metavar: "NAME" }), {
      description: message`Use the named account for signing operations`,
    }),
  ),
  password: withDefault(
    option("--password", string({ metavar: "PASSWORD" }), {
      description: message`Keystore password for decrypting the account key`,
    }),
    () => process.env.FAST_PASSWORD,
  ),
});
```

**IMPORTANT:** The implementer must check whether optique's `option()` function accepts `description` as a third argument or as part of an options object. Read the optique docs via context7 MCP (library ID `/dahlia/optique`) — query: `option description message third argument options object`. The exact API may be:

- `option("--name", string(), { description: message\`...\` })` — options object as third arg
- Or `option("--name", string({ metavar: "NAME" }), { description: message\`...\` })` — metavar on valueparser, description on option

- [ ] **Step 1.2: Update account command arguments**

For each account command parser, add metavars and descriptions to local options/arguments:

| Command | Arg/Option | Metavar | Description |
| --- | --- | --- | --- |
| account create | `--name` | `NAME` | `Alias for the account` |
| account import | `--name` | `NAME` | `Alias for the account` |
| account import | `--private-key` | `HEX` | `Hex-encoded Ed25519 seed (0x-prefixed or raw)` |
| account import | `--key-file` | `PATH` | `Path to a JSON file containing a privateKey field` |
| account set-default | name (positional) | `NAME` | `Alias of an existing account` |
| account info | name (positional) | `NAME` | `Account alias (defaults to default account)` |
| account export | name (positional) | `NAME` | `Account alias (defaults to default account)` |
| account delete | name (positional) | `NAME` | `Account alias to delete` |

Example for `accountImportParser`:

```typescript
const accountImportParser = command(
  "import",
  object({
    cmd: constant("account-import" as const),
    name: optional(
      option("--name", string({ metavar: "NAME" }), {
        description: message`Alias for the account`,
      }),
    ),
    privateKey: optional(
      option("--private-key", string({ metavar: "HEX" }), {
        description: message`Hex-encoded Ed25519 seed (0x-prefixed or raw)`,
      }),
    ),
    keyFile: optional(
      option("--key-file", string({ metavar: "PATH" }), {
        description: message`Path to a JSON file containing a privateKey field`,
      }),
    ),
  }),
  { description: message`Import an existing private key` },
);
```

For positional arguments with metavar:

```typescript
name: argument(string({ metavar: "NAME" }), {
  description: message`Account alias to delete`,
}),
```

- [ ] **Step 1.3: Update network command arguments**

| Command | Arg/Option | Metavar | Description |
| --- | --- | --- | --- |
| network add | name (positional) | `NAME` | `Name for the custom network` |
| network add | `--config` | `PATH` | `Path to network config JSON file` |
| network set-default | name (positional) | `NAME` | `Network name` |
| network remove | name (positional) | `NAME` | `Name of the custom network to remove` |

- [ ] **Step 1.4: Update info command arguments**

| Command | Arg/Option | Metavar | Description |
| --- | --- | --- | --- |
| info balance | `--address` | `ADDRESS` | `Any Fast address (fast1...) to query` |
| info balance | `--token` | `TOKEN` | `Filter by token` |
| info tx | hash (positional) | `HASH` | `Transaction hash (hex)` |
| info history | `--from` | `ADDRESS` | `Filter by sender account name or address` |
| info history | `--to` | `ADDRESS` | `Filter by recipient address` |
| info history | `--token` | `TOKEN` | `Filter by token` |
| info history | `--limit` | (integer, no metavar needed) | `Max number of records to return` |
| info history | `--offset` | (integer, no metavar needed) | `Number of records to skip` |

- [ ] **Step 1.5: Update send command arguments**

| Arg/Option | Metavar | Description |
| --- | --- | --- |
| address (positional) | `ADDRESS` | `Recipient address (fast1... for Fast, 0x... for EVM)` |
| amount (positional) | `AMOUNT` | `Human-readable amount (e.g., 10.5)` |
| `--token` | `TOKEN` | `Token to send (e.g., testUSDC, USDC)` |
| `--from-chain` | `CHAIN` | `Source EVM chain for bridge-in (e.g., arbitrum-sepolia)` |
| `--to-chain` | `CHAIN` | `Destination EVM chain for bridge-out (e.g., arbitrum-sepolia)` |

- [ ] **Step 1.6: Build + verify help output**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
node app/cli/dist/main.js --help
```

Expected: help text shows descriptive metavars (`--account NAME`, `--network NAME`, `ADDRESS`, `AMOUNT`, etc.) and descriptions for each option. No more bare `STRING`.

- [ ] **Step 1.7: Commit**

```bash
git add app/cli/src/cli.ts
git commit -m "docs(fast-cli): add metavars and descriptions to all CLI options"
```

---

## Task 2: Replace dispatch switch with handler registry

**Files:** Modify `app/cli/src/main.ts`

Replace the 16-case switch + 16 static imports with a handler registry using dynamic imports. This makes adding new commands a one-line change instead of two (import + case).

- [ ] **Step 2.1: Rewrite the dispatch section of `main.ts`**

Replace the 16 static handler imports (lines 13-28 in current file) and the switch block (lines 71-110) with:

```typescript
import type { CommandName, ParsedArgs } from "./cli.js";
import type { Effect } from "effect";
import type { ClientError } from "./errors/index.js";

type Handler = (args: ParsedArgs) => Effect.Effect<void, ClientError, unknown>;

const handlers: Record<CommandName, () => Promise<Handler>> = {
  "account-create": () => import("./commands/account/create.js").then((m) => m.accountCreateHandler),
  "account-delete": () => import("./commands/account/delete.js").then((m) => m.accountDeleteHandler),
  "account-export": () => import("./commands/account/export.js").then((m) => m.accountExportHandler),
  "account-import": () => import("./commands/account/import.js").then((m) => m.accountImportHandler),
  "account-info": () => import("./commands/account/info.js").then((m) => m.accountInfoHandler),
  "account-list": () => import("./commands/account/list.js").then((m) => m.accountListHandler),
  "account-set-default": () => import("./commands/account/set-default.js").then((m) => m.accountSetDefaultHandler),
  "info-balance": () => import("./commands/info/balance.js").then((m) => m.infoBalanceHandler),
  "info-history": () => import("./commands/info/history.js").then((m) => m.infoHistoryHandler),
  "info-status": () => import("./commands/info/status.js").then((m) => m.infoStatusHandler),
  "info-tx": () => import("./commands/info/tx.js").then((m) => m.infoTxHandler),
  "network-add": () => import("./commands/network/add.js").then((m) => m.networkAddHandler),
  "network-list": () => import("./commands/network/list.js").then((m) => m.networkListHandler),
  "network-remove": () => import("./commands/network/remove.js").then((m) => m.networkRemoveHandler),
  "network-set-default": () => import("./commands/network/set-default.js").then((m) => m.networkSetDefaultHandler),
  "send": () => import("./commands/send.js").then((m) => m.sendHandler),
};

const dispatch = async (): Promise<void> => {
  const handler = await handlers[parsed.cmd]();
  return runHandler(globalOpts, handler(parsed));
};
```

This eliminates:

- 16 static import lines at the top
- The 40-line switch block
- The `never` exhaustiveness check (TypeScript checks `Record<CommandName, ...>` covers all keys at definition time)

The `handlers` record is typed as `Record<CommandName, ...>` — if a new command is added to `CommandName` in `cli.ts`, TypeScript will error that the registry is missing it. Same safety as the switch `never` check.

**Note:** Dynamic imports mean command modules are loaded only when their command is invoked, not at startup. This slightly improves startup time for `--help`/`--version` (no need to load all command code).

- [ ] **Step 2.2: Clean up unused imports**

After removing the 16 static handler imports, remove any unused imports (`Effect`, `ClientError` as value imports if they're only used as types — use `import type` instead).

- [ ] **Step 2.3: Build + smoke-test**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
pnpm -F @fastxyz/fast-cli build 2>&1 | tail -3
rm -rf ~/.fast
node app/cli/dist/main.js --help
node app/cli/dist/main.js network list --json
node app/cli/dist/main.js account create --name registry-test --password testpw --non-interactive --json
node app/cli/dist/main.js account delete registry-test --non-interactive --json
```

Expected: all commands work identically to before. The registry is transparent to the user.

- [ ] **Step 2.4: Commit**

```bash
git add app/cli/src/main.ts
git commit -m "refactor(fast-cli): replace dispatch switch with handler registry"
```

---

## Verification

After both tasks:

```bash
node app/cli/dist/main.js --help
```

Expected output should look like:

```text
Usage: fast account (create | import | list | ...) [OPTIONS]
       fast network (list | add | ...) [OPTIONS]
       fast info (status | balance | ...) [OPTIONS]
       fast send ADDRESS AMOUNT [OPTIONS]
       fast --help
       fast --version

  account                     Manage accounts
  network                     Manage networks
  info                        Query network and account information
  send                        Send tokens (Fast→Fast, EVM→Fast, or Fast→EVM)
  --json                      Emit machine-parseable JSON to stdout
  --debug                     Enable verbose logging to stderr
  --non-interactive           Auto-confirm dangerous operations
  --network NAME              Override the network for this command
  --account NAME              Use the named account for signing
  --password PASSWORD         Keystore password
```

No bare `STRING`. Every option has a description. Metavars are descriptive.
