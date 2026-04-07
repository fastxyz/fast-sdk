/**
 * Optique-based CLI parser definitions for fast-cli.
 *
 * Every leaf command produces a typed object with a `cmd` discriminant field
 * so that dispatch in main.ts can be a type-safe `switch`.
 */
import { merge, object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option, passThrough } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

// ---------------------------------------------------------------------------
// Global options (shared by every leaf command)
// ---------------------------------------------------------------------------

/**
 * Lenient pre-parser that extracts global meta-flags (--json, --help, --version)
 * from argv without failing on unknown tokens. Used by main.ts to determine
 * output mode before the full parse.
 */
export const globalPreParser = object({
  json: withDefault(option("--json"), false),
  help: withDefault(option("--help"), false),
  version: withDefault(option("--version"), false),
  _rest: passThrough({ format: "greedy" }),
});

export const globalOptions = object({
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

// ---------------------------------------------------------------------------
// Account commands
// ---------------------------------------------------------------------------

const accountCreateParser = command(
  "create",
  object({
    cmd: constant("account-create" as const),
    name: optional(
      option("--name", string({ metavar: "NAME" }), {
        description: message`Alias for the account`,
      }),
    ),
  }),
  { description: message`Create a new account` },
);

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

const accountListParser = command(
  "list",
  object({
    cmd: constant("account-list" as const),
  }),
  { description: message`List all accounts` },
);

const accountSetDefaultParser = command(
  "set-default",
  object({
    cmd: constant("account-set-default" as const),
    name: argument(string({ metavar: "NAME" }), {
      description: message`Alias of an existing account`,
    }),
  }),
  { description: message`Set the default account` },
);

const accountInfoParser = command(
  "info",
  object({
    cmd: constant("account-info" as const),
    name: optional(
      argument(string({ metavar: "NAME" }), {
        description: message`Account alias (defaults to default account)`,
      }),
    ),
  }),
  { description: message`Show account addresses` },
);

const accountExportParser = command(
  "export",
  object({
    cmd: constant("account-export" as const),
    name: optional(
      argument(string({ metavar: "NAME" }), {
        description: message`Account alias (defaults to default account)`,
      }),
    ),
  }),
  { description: message`Export (decrypt) the private key` },
);

const accountDeleteParser = command(
  "delete",
  object({
    cmd: constant("account-delete" as const),
    name: argument(string({ metavar: "NAME" }), {
      description: message`Account alias to delete`,
    }),
  }),
  { description: message`Delete an account` },
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
  { description: message`Manage accounts` },
);

// ---------------------------------------------------------------------------
// Network commands
// ---------------------------------------------------------------------------

const networkListParser = command(
  "list",
  object({
    cmd: constant("network-list" as const),
  }),
  { description: message`List available networks` },
);

const networkAddParser = command(
  "add",
  object({
    cmd: constant("network-add" as const),
    name: argument(string({ metavar: "NAME" }), {
      description: message`Name for the custom network`,
    }),
    config: option("--config", string({ metavar: "PATH" }), {
      description: message`Path to network config JSON file`,
    }),
  }),
  { description: message`Add a custom network config` },
);

const networkSetDefaultParser = command(
  "set-default",
  object({
    cmd: constant("network-set-default" as const),
    name: argument(string({ metavar: "NAME" }), {
      description: message`Network name`,
    }),
  }),
  { description: message`Set the default network` },
);

const networkRemoveParser = command(
  "remove",
  object({
    cmd: constant("network-remove" as const),
    name: argument(string({ metavar: "NAME" }), {
      description: message`Name of the custom network to remove`,
    }),
  }),
  { description: message`Remove a custom network` },
);

const networkGroup = command(
  "network",
  or(
    networkListParser,
    networkAddParser,
    networkSetDefaultParser,
    networkRemoveParser,
  ),
  { description: message`Manage networks` },
);

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

const infoStatusParser = command(
  "status",
  object({
    cmd: constant("info-status" as const),
  }),
  { description: message`Health check for current network` },
);

const infoBalanceParser = command(
  "balance",
  object({
    cmd: constant("info-balance" as const),
    address: optional(
      option("--address", string({ metavar: "ADDRESS" }), {
        description: message`Any Fast address (fast1...) to query`,
      }),
    ),
    token: optional(
      option("--token", string({ metavar: "TOKEN" }), {
        description: message`Filter by token`,
      }),
    ),
  }),
  { description: message`Show token balances for an address` },
);

const infoTxParser = command(
  "tx",
  object({
    cmd: constant("info-tx" as const),
    hash: argument(string({ metavar: "HASH" }), {
      description: message`Transaction hash (hex)`,
    }),
  }),
  { description: message`Look up a transaction by hash` },
);

const infoHistoryParser = command(
  "history",
  object({
    cmd: constant("info-history" as const),
    from: optional(
      option("--from", string({ metavar: "ADDRESS" }), {
        description: message`Filter by sender account name or address`,
      }),
    ),
    to: optional(
      option("--to", string({ metavar: "ADDRESS" }), {
        description: message`Filter by recipient address`,
      }),
    ),
    token: optional(
      option("--token", string({ metavar: "TOKEN" }), {
        description: message`Filter by token`,
      }),
    ),
    limit: withDefault(
      option("--limit", integer(), {
        description: message`Max number of records to return`,
      }),
      20,
    ),
    offset: withDefault(
      option("--offset", integer(), {
        description: message`Number of records to skip`,
      }),
      0,
    ),
  }),
  { description: message`Show transaction history` },
);

const infoGroup = command(
  "info",
  or(infoStatusParser, infoBalanceParser, infoTxParser, infoHistoryParser),
  { description: message`Query network and account information` },
);

// ---------------------------------------------------------------------------
// Send command (top-level)
// ---------------------------------------------------------------------------

const sendParser = command(
  "send",
  object({
    cmd: constant("send" as const),
    address: argument(string({ metavar: "ADDRESS" }), {
      description: message`Recipient address (fast1... for Fast, 0x... for EVM)`,
    }),
    amount: argument(string({ metavar: "AMOUNT" }), {
      description: message`Human-readable amount (e.g., 10.5)`,
    }),
    token: optional(
      option("--token", string({ metavar: "TOKEN" }), {
        description: message`Token to send (e.g., testUSDC, USDC)`,
      }),
    ),
    fromChain: optional(
      option("--from-chain", string({ metavar: "CHAIN" }), {
        description: message`Source EVM chain for bridge-in (e.g., arbitrum-sepolia)`,
      }),
    ),
    toChain: optional(
      option("--to-chain", string({ metavar: "CHAIN" }), {
        description: message`Destination EVM chain for bridge-out (e.g., arbitrum-sepolia)`,
      }),
    ),
  }),
  { description: message`Send tokens (Fast→Fast, EVM→Fast, or Fast→EVM)` },
);

// ---------------------------------------------------------------------------
// Fund commands
// ---------------------------------------------------------------------------

const fundFiatParser = command(
  "fiat",
  object({
    cmd: constant("fund-fiat" as const),
    address: optional(
      option("--address", string({ metavar: "ADDRESS" }), {
        description: message`Fast address to fund (default: default account)`,
      }),
    ),
  }),
  { description: message`Get a fiat on-ramp funding URL` },
);

const fundCryptoParser = command(
  "crypto",
  object({
    cmd: constant("fund-crypto" as const),
  }),
  { description: message`Show EVM address for crypto funding` },
);

const fundGroup = command(
  "fund",
  or(fundFiatParser, fundCryptoParser),
  { description: message`Fund your account` },
);

// ---------------------------------------------------------------------------
// Pay command
// ---------------------------------------------------------------------------

const payParser = command(
  "pay",
  object({
    cmd: constant("pay" as const),
    url: argument(string({ metavar: "URL" }), {
      description: message`URL of the x402-protected resource`,
    }),
    dryRun: withDefault(
      option("--dry-run", {
        description: message`Inspect payment requirements without paying`,
      }),
      false,
    ),
    method: withDefault(
      option("--method", string({ metavar: "METHOD" }), {
        description: message`HTTP method (default: GET)`,
      }),
      "GET",
    ),
    header: withDefault(
      multiple(
        option("--header", string({ metavar: "KEY: VALUE" }), {
          description: message`Custom header (repeatable)`,
        }),
      ),
      [] as string[],
    ),
    body: optional(
      option("--body", string({ metavar: "DATA" }), {
        description: message`Request body (prefix with @ to read from file)`,
      }),
    ),
  }),
  { description: message`Access an x402 payment-protected resource` },
);

// ---------------------------------------------------------------------------
// Root parser — merge global options with the command union
// ---------------------------------------------------------------------------

const commands = or(accountGroup, networkGroup, infoGroup, sendParser, fundGroup, payParser);

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

export type FundFiatArgs = InferValue<typeof fundFiatParser>;
export type FundCryptoArgs = InferValue<typeof fundCryptoParser>;
export type PayArgs = InferValue<typeof payParser>;

/** The full parsed result: global options merged with the chosen command. */
export type ParsedArgs = InferValue<typeof parser>;

/** Union of just the leaf-command discriminants. */
export type CommandName = ParsedArgs["cmd"];

// Re-export for convenience
export type { InferValue } from "@optique/core/parser";
