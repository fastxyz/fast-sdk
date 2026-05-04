/**
 * Optique-based CLI parser definitions for fast-cli.
 *
 * Every leaf command produces a typed object with a `cmd` discriminant field
 * so that dispatch in main.ts can be a type-safe `switch`.
 */
import { merge, object, or } from "@optique/core/constructs";
import { message, optionName } from "@optique/core/message";
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
  network: optional(
    option("--network", string({ metavar: "NAME" }), {
      description: message`Override the network for this command`,
    }),
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
    token: optional(
      option("--token", string({ metavar: "TOKEN" }), {
        description: message`Filter by token name or token ID`,
      }),
    ),
  }),
  { description: message`Show token balances for the current account` },
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

const infoBridgeTokensParser = command(
  "bridge-tokens",
  object({
    cmd: constant("info-bridge-tokens" as const),
  }),
  { description: message`List tokens available for Fast-EVM transfers` },
);

const infoBridgeChainsParser = command(
  "bridge-chains",
  object({
    cmd: constant("info-bridge-chains" as const),
  }),
  { description: message`List chains available for Fast-EVM transfers` },
);

const infoGroup = command(
  "info",
  or(infoStatusParser, infoBalanceParser, infoTxParser, infoHistoryParser, infoBridgeTokensParser, infoBridgeChainsParser),
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
    eip7702: withDefault(
      option("--eip-7702", {
        description: message`Use EIP-7702 smart deposit for EVM → Fast (gas paid in USDC, no ETH required)`,
      }),
      false,
    ),
  }),
  { description: message`Send tokens (Fast → Fast, EVM → Fast, or Fast → EVM)` },
);

// ---------------------------------------------------------------------------
// Fund commands
// ---------------------------------------------------------------------------

const fundUsdcFiatParser = command(
  "fiat",
  object({
    cmd: constant("fund-usdc-fiat" as const),
    address: optional(
      option("--address", string({ metavar: "ADDRESS" }), {
        description: message`Fast address to fund (default: default account)`,
      }),
    ),
  }),
  { description: message`Get a fiat on-ramp funding URL (USDC via Ramp)` },
);

const fundUsdcCryptoParser = command(
  "crypto",
  object({
    cmd: constant("fund-usdc-crypto" as const),
    amount: argument(string({ metavar: "AMOUNT" }), {
      description: message`Human-readable amount to fund (e.g., 100.00)`,
    }),
    chain: option("--chain", string({ metavar: "CHAIN" }), {
      description: message`EVM chain to bridge from (see fast info bridge-chains)`,
    }),
    token: optional(
      option("--token", string({ metavar: "TOKEN" }), {
        description: message`Token to bridge (default: USDC / testUSDC)`,
      }),
    ),
    eip7702: withDefault(
      option("--eip-7702", {
        description: message`Use EIP-7702 smart deposit (gas paid in USDC via paymaster, no ETH required)`,
      }),
      false,
    ),
  }),
  { description: message`Bridge USDC from an EVM chain into your Fast account` },
);

const fundUsdcGroup = command(
  "usdc",
  or(fundUsdcFiatParser, fundUsdcCryptoParser),
  { description: message`Fund your Fast account with USDC (fiat or crypto)` },
);

const fundFastUsdParser = command(
  "fastusd",
  object({
    cmd: constant("fund-fastusd" as const),
    to: optional(
      option("--to", string({ metavar: "ADDRESS" }), {
        description: message`Fast address to fund (default: default account)`,
      }),
    ),
    amount: optional(
      option("--amount", string({ metavar: "AMOUNT" }), {
        description: message`Optional amount (decimal, e.g. 10.5)`,
      }),
    ),
  }),
  {
    description: message`Print a Fast web-app URL to fund your account with fastUSD (mainnet only)`,
  },
);

const fundGroup = command(
  "fund",
  or(fundUsdcGroup, fundFastUsdParser),
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
// Multisig commands
// ---------------------------------------------------------------------------

const multisigInitParser = command(
  "init",
  object({
    cmd: constant("multisig-init" as const),
    signers: option("--signers", string({ metavar: "ADDR_OR_NAME,..." }), {
      description: message`Comma-separated bech32 addresses or local account names`,
    }),
    quorum: option("--quorum", integer({ metavar: "N" }), {
      description: message`Number of signatures required to authorize a transaction`,
    }),
    configNonce: option("--config-nonce", string({ metavar: "U64" }), {
      description: message`Nonce included in the multisig config (decimal u64)`,
    }),
    name: option("--name", string({ metavar: "ALIAS" }), {
      description: message`Local alias for the multisig wallet`,
    }),
    network: optional(
      option("--network", string({ metavar: "NAME" }), {
        description: message`Network the wallet config targets (defaults to current)`,
      }),
    ),
    setDefault: withDefault(
      option("--set-default", {
        description: message`Mark this wallet as the default account`,
      }),
      false,
    ),
  }),
  { description: message`Create a multisig wallet config` },
);

const multisigExportParser = command(
  "export",
  object({
    cmd: constant("multisig-export" as const),
    name: argument(string({ metavar: "NAME" })),
    out: optional(option("--out", string({ metavar: "PATH" }))),
  }),
  { description: message`Export a multisig wallet config as JSON` },
);

const multisigImportParser = command(
  "import",
  merge(
    object({
      cmd: constant("multisig-import" as const),
      name: optional(
        option("--name", string({ metavar: "ALIAS" }), {
          description: message`Local alias for the multisig wallet (required when not using --from)`,
        }),
      ),
      network: optional(
        option("--network", string({ metavar: "NAME" }), {
          description: message`Network the wallet config targets (defaults to current)`,
        }),
      ),
      setDefault: withDefault(
        option("--set-default", {
          description: message`Mark this wallet as the default account`,
        }),
        false,
      ),
    }),
    or(
      object({
        from: option("--from", string({ metavar: "FILE" }), {
          description: message`Path to a multisig wallet config JSON to import`,
        }),
      }),
      object({
        signers: option("--signers", string({ metavar: "ADDR,..." }), {
          description: message`Comma-separated bech32 fast addresses (sorted/dedup'd)`,
        }),
        quorum: option("--quorum", integer({ metavar: "N" }), {
          description: message`Number of signatures required to authorize a transaction`,
        }),
        configNonce: option("--config-nonce", string({ metavar: "U64" }), {
          description: message`Nonce included in the multisig config (decimal u64)`,
        }),
        expectAddress: optional(
          option("--expect-address", string({ metavar: "ADDR" }), {
            description: message`If set, verify the derived address matches this value`,
          }),
        ),
      }),
    ),
  ),
  { description: message`Import an existing multisig wallet` },
);

const multisigPendingParser = command(
  "pending",
  object({
    cmd: constant("multisig-pending" as const),
    asMember: optional(
      option("--as", string({ metavar: "NAME" }), {
        description: message`Local single-signer account to check "have I signed"`,
      }),
    ),
  }),
  { description: message`List pending multisig transactions for the active wallet` },
);

const multisigGroup = command(
  "multisig",
  or(
    multisigInitParser,
    multisigExportParser,
    multisigImportParser,
    multisigPendingParser,
  ),
  { description: message`Multisig wallet operations` },
);

// ---------------------------------------------------------------------------
// Root parser — merge global options with the command union
// ---------------------------------------------------------------------------

const commands = or(
  accountGroup,
  networkGroup,
  infoGroup,
  sendParser,
  fundGroup,
  payParser,
  multisigGroup,
);

export const parser = merge(globalOptions, commands);

// ---------------------------------------------------------------------------
// Exported types — one per leaf command, plus the root union
// ---------------------------------------------------------------------------

export type AccountCreateArgs = InferValue<typeof accountCreateParser>;
export type AccountImportArgs = InferValue<typeof accountImportParser>;
export type AccountListArgs = InferValue<typeof accountListParser>;
export type AccountSetDefaultArgs = InferValue<typeof accountSetDefaultParser>;
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
export type InfoBridgeTokensArgs = InferValue<typeof infoBridgeTokensParser>;
export type InfoBridgeChainsArgs = InferValue<typeof infoBridgeChainsParser>;

export type SendArgs = InferValue<typeof sendParser>;

export type FundUsdcFiatArgs = InferValue<typeof fundUsdcFiatParser>;
export type FundUsdcCryptoArgs = InferValue<typeof fundUsdcCryptoParser>;
export type FundFastUsdArgs = InferValue<typeof fundFastUsdParser>;
export type PayArgs = InferValue<typeof payParser>;

export type MultisigInitArgs = InferValue<typeof multisigInitParser>;
export type MultisigExportArgs = InferValue<typeof multisigExportParser>;
export type MultisigImportArgs = InferValue<typeof multisigImportParser>;
export type MultisigPendingArgs = InferValue<typeof multisigPendingParser>;

/** The full parsed result: global options merged with the chosen command. */
export type ParsedArgs = InferValue<typeof parser>;

/** Union of just the leaf-command discriminants. */
export type CommandName = ParsedArgs["cmd"];

// Re-export for convenience
export type { InferValue } from "@optique/core/parser";
