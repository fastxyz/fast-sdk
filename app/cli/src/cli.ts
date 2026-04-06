/**
 * Optique-based CLI parser definitions for fast-cli.
 *
 * Every leaf command produces a typed object with a `cmd` discriminant field
 * so that dispatch in main.ts can be a type-safe `switch`.
 */
import { merge, object, or } from "@optique/core/constructs";
import { optional, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

// ---------------------------------------------------------------------------
// Global options (shared by every leaf command)
// ---------------------------------------------------------------------------

const globalOptions = object({
  json: withDefault(option("--json"), false),
  debug: withDefault(option("--debug"), false),
  nonInteractive: withDefault(option("--non-interactive"), false),
  network: withDefault(option("--network", string()), "testnet"),
  account: optional(option("--account", string())),
  password: withDefault(
    option("--password", string()),
    () => process.env.FAST_PASSWORD,
  ),
});

// ---------------------------------------------------------------------------
// Account commands
// ---------------------------------------------------------------------------

const accountCreateParser = command(
  "create",
  object({
    cmd: constant("account-create" as const),
    name: optional(option("--name", string())),
  }),
);

const accountImportParser = command(
  "import",
  object({
    cmd: constant("account-import" as const),
    name: optional(option("--name", string())),
    privateKey: optional(option("--private-key", string())),
    keyFile: optional(option("--key-file", string())),
  }),
);

const accountListParser = command(
  "list",
  object({
    cmd: constant("account-list" as const),
  }),
);

const accountSetDefaultParser = command(
  "set-default",
  object({
    cmd: constant("account-set-default" as const),
    name: argument(string()),
  }),
);

const accountInfoParser = command(
  "info",
  object({
    cmd: constant("account-info" as const),
    name: optional(argument(string())),
  }),
);

const accountExportParser = command(
  "export",
  object({
    cmd: constant("account-export" as const),
    name: optional(argument(string())),
  }),
);

const accountDeleteParser = command(
  "delete",
  object({
    cmd: constant("account-delete" as const),
    name: argument(string()),
  }),
);

const accountGroup = command(
  "account",
  or(
    accountCreateParser,
    accountImportParser,
    accountListParser,
    accountSetDefaultParser,
    accountInfoParser,
    accountExportParser,
    accountDeleteParser,
  ),
);

// ---------------------------------------------------------------------------
// Network commands
// ---------------------------------------------------------------------------

const networkListParser = command(
  "list",
  object({
    cmd: constant("network-list" as const),
  }),
);

const networkAddParser = command(
  "add",
  object({
    cmd: constant("network-add" as const),
    name: argument(string()),
    config: option("--config", string()),
  }),
);

const networkSetDefaultParser = command(
  "set-default",
  object({
    cmd: constant("network-set-default" as const),
    name: argument(string()),
  }),
);

const networkRemoveParser = command(
  "remove",
  object({
    cmd: constant("network-remove" as const),
    name: argument(string()),
  }),
);

const networkGroup = command(
  "network",
  or(networkListParser, networkAddParser, networkSetDefaultParser, networkRemoveParser),
);

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

const infoStatusParser = command(
  "status",
  object({
    cmd: constant("info-status" as const),
  }),
);

const infoBalanceParser = command(
  "balance",
  object({
    cmd: constant("info-balance" as const),
    address: optional(option("--address", string())),
    token: optional(option("--token", string())),
  }),
);

const infoTxParser = command(
  "tx",
  object({
    cmd: constant("info-tx" as const),
    hash: argument(string()),
  }),
);

const infoHistoryParser = command(
  "history",
  object({
    cmd: constant("info-history" as const),
    from: optional(option("--from", string())),
    to: optional(option("--to", string())),
    token: optional(option("--token", string())),
    limit: withDefault(option("--limit", integer()), 20),
    offset: withDefault(option("--offset", integer()), 0),
  }),
);

const infoGroup = command(
  "info",
  or(infoStatusParser, infoBalanceParser, infoTxParser, infoHistoryParser),
);

// ---------------------------------------------------------------------------
// Send command (top-level)
// ---------------------------------------------------------------------------

const sendParser = command(
  "send",
  object({
    cmd: constant("send" as const),
    address: argument(string()),
    amount: argument(string()),
    token: optional(option("--token", string())),
    fromChain: optional(option("--from-chain", string())),
    toChain: optional(option("--to-chain", string())),
  }),
);

// ---------------------------------------------------------------------------
// Root parser — merge global options with the command union
// ---------------------------------------------------------------------------

const commands = or(accountGroup, networkGroup, infoGroup, sendParser);

export const parser = merge(globalOptions, commands);

// ---------------------------------------------------------------------------
// Exported types — one per leaf command, plus the root union
// ---------------------------------------------------------------------------

export type AccountCreateArgs = InferValue<typeof accountCreateParser>;
export type AccountImportArgs = InferValue<typeof accountImportParser>;
export type AccountListArgs = InferValue<typeof accountListParser>;
export type AccountSetDefaultArgs = InferValue<typeof accountSetDefaultParser>;
export type AccountInfoArgs = InferValue<typeof accountInfoParser>;
export type AccountExportArgs = InferValue<typeof accountExportParser>;
export type AccountDeleteArgs = InferValue<typeof accountDeleteParser>;

export type NetworkListArgs = InferValue<typeof networkListParser>;
export type NetworkAddArgs = InferValue<typeof networkAddParser>;
export type NetworkSetDefaultArgs = InferValue<typeof networkSetDefaultParser>;
export type NetworkRemoveArgs = InferValue<typeof networkRemoveParser>;

export type InfoStatusArgs = InferValue<typeof infoStatusParser>;
export type InfoBalanceArgs = InferValue<typeof infoBalanceParser>;
export type InfoTxArgs = InferValue<typeof infoTxParser>;
export type InfoHistoryArgs = InferValue<typeof infoHistoryParser>;

export type SendArgs = InferValue<typeof sendParser>;

/** The full parsed result: global options merged with the chosen command. */
export type ParsedArgs = InferValue<typeof parser>;

/** Union of just the leaf-command discriminants. */
export type CommandName = ParsedArgs["cmd"];

// Re-export for convenience
export type { InferValue } from "@optique/core/parser";
