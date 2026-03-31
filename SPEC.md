<!-- markdownlint-disable MD013 MD036 MD060 -->

# `fast` CLI Specification

Version: 0.1.0-draft\
Date: 2026-03-31

## 1. Overview

`fast` is a unified command-line interface that consolidates the Fast network SDK
(`@fastxyz/sdk`) and the AllSet portal SDK (`@fastxyz/allset-sdk`) into a single
tool for managing accounts, moving assets, and querying network state.

### Design goals:

- **Agent-friendly.** Every command supports `--json` for structured output and
  `--help` for self-documenting usage. An AI agent's workflow is:
  read `SKILL.md` → run `--help --json` → execute → parse JSON envelope → on error, branch on error code.
- **Human-friendly.** Interactive mode by default with confirmation prompts,
  human-readable output, and sensible defaults.
- **Single entry point.** No sub-skills, no separate binaries. One CLI covers
  Fast-to-Fast transfers, EVM-Fast transfers, on-ramp funding, and payments via protocols such as x402.
- **≤7 top-level command.** A thin surface is preferred by agents. 

## 2. Global Flags

Every command inherits these flags. They are parsed before command-specific flags.

| Flag                 | Type    | Default                     | Description                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--version`          | —       | —                           | Print current version of the CLI.                                                                                                                                                                                                                                                                                                                                                         |
| `--help`             | boolean | —                           | Print detailed usage with examples, then exit 0. When combined with `--json`, output help as structured JSON.                                                                                                                                                                                                                                                                             |
| `--debug`            | boolean | `false`                     | Enable verbose logging to **stderr**. Never affects stdout or JSON output. An agent never uses this flag. Instead, the JSON error output itself should be rich enough for agents to self-diagnose.                                                                                                                                                                                        |
| `--json`             | boolean | `false`                     | Emit machine-parseable JSON to stdout. JSON output follows a predefined schema to help agents parse it. Implies `--non-interactive`.                                                                                                                                                                                                                                                      |
| `--network <name>`   | string  | `testnet`                   | Override the network for this command. Must be a name from `fast network list`.                                                                                                                                                                                                                                                                                                           |
| `--non-interactive`  | boolean | `false`                     | Auto-confirms dangerous operations but fails with exit code 2 when required input is missing (e.g., amount not provided).                                                                                                                                                                                                                                                                 |
| `--account <name>`   | string  | *first in the account list* | Use the named account for signing operations. Errors with exit code 3 if not found.                                                                                                                                                                                                                                                                                                       |
| `--password <value>` | string  | —                           | Keystore password for decrypting the account key. If omitted in interactive mode, the CLI prompts via masked stdin. Can also be set via `FAST_PASSWORD` env var. In `--non-interactive` mode, one of `--password` or `FAST_PASSWORD` is required for any signing operation. When used, add a warning note: the password will be visible in shell history; prefer `FAST_PASSWORD` env var. |

### Hex Input Convention

All flags and arguments that accept hex values (private keys, token IDs,
transaction hashes, EVM addresses) accept both `0x`-prefixed and raw hex.
The CLI normalizes to `0x`-prefixed internally. JSON output always includes the
`0x` prefix.

## 3. Account Storage

All account data is stored under `~/.fast/`. The directory is created on first use
with mode `0700`.

```text
~/.fast/
├── accounts.json          # Account registry
├── networks.json          # Network registry (mainnet, testnet, custom networks)
├── keys/
│   └── <name>.json        # Per-account keyfile (mode 0600)
└── networks/
    └── <name>.json        # Custom network config (mode 0600)
```

### 3.1 `accounts.json`

```json
{
  "default": "my-account",
  "accounts": [
    { "name": "my-account", "createdAt": "2026-03-31T00:00:00Z" }
  ]
}
```

When no accounts exist, the file contains `{"default": null, "accounts": []}`.

### 3.2 Keyfile format (`~/.fast/keys/<name>.json`)

Keyfiles are **encrypted at rest** using AES-256-CTR with a password-derived key
(scrypt KDF), following the Ethereum JSON Keystore V3 standard. The private key
is never stored in plaintext.

```json
{
  "version": 3,
  "id": "a1b2c3d4-...",
  "fastAddress": "fast1qw5...x9z",
  "evmAddress": "0x7a3f...b2c1",
  "crypto": {
    "cipher": "aes-256-ctr",
    "cipherparams": { "iv": "0x<hex>" },
    "ciphertext": "0x<hex>",
    "kdf": "scrypt",
    "kdfparams": {
      "dklen": 32,
      "n": 262144,
      "r": 8,
      "p": 1,
      "salt": "0x<hex>"
    },
    "mac": "0x<hex>"
  },
  "createdAt": "2026-03-31T00:00:00Z"
}
```

The encrypted payload is an Ed25519 seed (32 bytes). From this single key the
CLI derives:

- **Fast address**: Ed25519 public key encoded as bech32m with `fast` prefix
  (via `Signer` from `@fastxyz/sdk`).
- **EVM address**: Derived via `createEvmWallet` from `@fastxyz/allset-sdk`
  (needed for bridge deposits).

Addresses are stored unencrypted in the keyfile for quick lookups (e.g.,
`fast account list`) without requiring the password. Only the private key is
encrypted.

### 3.3 Password handling

The keystore password is required to decrypt keys for signing operations
(`send`, `pay`) and for `account export`. It can be provided via:

1. `--password <value>` flag (highest priority)
2. `FAST_PASSWORD` environment variable
3. Interactive masked prompt (only in interactive mode)

In `--non-interactive` mode, if no password is available from (1) or (2), the
CLI exits with code 8 (`PASSWORD_REQUIRED`).

The password is **not stored** by the CLI. Users choose their own password at
account creation time. Different accounts may use different passwords.

### 3.4 `networks.json`

```json
{
  "default": "mainnet",
  "networks": ["testnet", "mainnet", "staging"]
}
```

`testnet` and `mainnet` are always present (bundled). Custom network names
refer to config files at `~/.fast/networks/<name>.json`.

### 3.5 Custom network config (`~/.fast/networks/<name>.json`)

```json
{
  "fast": {
    "rpcUrl": "http://localhost:9000",
    "explorerUrl": "http://localhost:8080"
  },
  "allset": {
    "crossSignUrl": "https://staging.cross-sign.allset.fast.xyz",
    "chains": {
      "arbitrum-sepolia": {
        "chainId": 421614,
        "bridgeContract": "0x...",
        "fastBridgeAddress": "fast1...",
        "relayerUrl": "https://staging.allset.fast.xyz/arbitrum-sepolia/relayer",
        "tokens": {
          "USDC": {
            "evmAddress": "0x...",
            "fastTokenId": "0x...",
            "decimals": 6
          }
        }
      }
    }
  }
}
```

### 3.6 Auto-naming

When a command creates an account without an explicit name, the CLI assigns
`account-1`, `account-2`, etc., incrementing past any existing names.

## 4. JSON Output Envelope

Every `--json` response uses a consistent envelope on stdout.

**Success:**

```json
{
  "ok": true,
  "data": { }
}
```

**Error:**

```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Human-readable description"
  }
}
```

Rules:

- The envelope is always a single JSON object, never streamed or line-delimited.
- The `data` shape is defined per-command in section 6.
- Human-readable output goes to stdout. Debug logging goes to stderr.
- When `--json` is set, **only** the JSON envelope is emitted to stdout.

## 5. Exit Codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | Success                                                               |
| 1    | General / unknown error                                               |
| 2    | Invalid usage (bad flags, missing arguments, address format mismatch) |
| 3    | Account not found                                                     |
| 4    | Insufficient balance                                                  |
| 5    | Network error (RPC unreachable, timeout)                              |
| 6    | Transaction failed (rejected by network)                              |
| 7    | User cancelled (interactive prompt declined)                          |
| 8    | Password required or incorrect                                        |

## 6. Commands

**Naming conventions:**

- `fast account *` — local account management (create, delete, import, export)
- `fast network *` — network config management (add, remove, set-default)
- `fast info *` — read-only queries (no signing, no password required)
- `fast <verb>` — write operations that sign and submit transactions

```text
fast account create          Create a new account
fast account import          Import an existing private key
fast account list            List all accounts
fast account set-default     Set the default account
fast account info            Show account addresses
fast account export          Export (decrypt) the private key
fast account delete          Delete an account

fast network list            List available networks
fast network set-default     Set the default network
fast network add             Add a custom network config
fast network remove          Remove a custom network

fast info status             Health check for current network
fast info balance            Show token balances for an address
fast info tx                 Look up a transaction by hash
fast info history            Show transaction history
fast info bridge-tokens      List tokens available for Fast-EVM transfers; just USDC for now.
fast info bridge-chains      List chains available for Fast-EVM transfers

fast fund                    Fund fast account from crypto or fiat; may need human intervention
fast send                    Send tokens between Fast and/or supported chains
fast pay                     Pay via payment links/protocols (e.g., x402)
```

### 6.1 `fast account create`

**Synopsis**

```text
fast account create [--name <name>]
```

**Description**

Generate a new Ed25519 keypair, encrypt it with a password, and store it as a
named account. If this is the first account, it is automatically set as the
default.

**Flags**

| Flag     | Type   | Required | Default            | Description                           |
| -------- | ------ | -------- | ------------------ | ------------------------------------- |
| `--name` | string | no       | auto (`account-N`) | Human-readable alias for the account. |

Password is provided via `--password`, `FAST_PASSWORD` env var, or interactive
prompt (see section 3.3).

**Behavior**

1. Prompt for a password (interactive) or read from flag/env var.
2. Generate 32 random bytes via `crypto.getRandomValues` as the Ed25519 seed.
3. Derive the Fast address (bech32m) and EVM address.
4. Encrypt the seed using the password (AES-256-CTR + scrypt).
5. Write encrypted keyfile to `~/.fast/keys/<name>.json` with mode `0600`.
6. Append entry to `accounts.json`. If no default exists, set this account as default.
7. Print the account name and addresses.

**Output (human)**

```text
Created account "account-1"
  Fast address: fast1qw5...x9z
  EVM address:  0x7a3f...b2c1
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "account-1",
    "fastAddress": "fast1qw5...x9z",
    "evmAddress": "0x7a3f...b2c1"
  }
}
```

**Errors**

| Condition                               | Exit | Code                |
| --------------------------------------- | ---- | ------------------- |
| Name already exists                     | 2    | `ACCOUNT_EXISTS`    |
| No password in `--non-interactive` mode | 8    | `PASSWORD_REQUIRED` |
| Cannot write to `~/.fast/`              | 1    | `STORAGE_ERROR`     |

### 6.2 `fast account import`

**Synopsis**

```text
fast account import [--name <name>] [--private-key <hex> | --key-file <path>]
```

**Description**

Import an existing Ed25519 private key as a named account. The key is encrypted
with a password before storage. The `--private-key` and `--key-file` flags are
mutually exclusive. In interactive mode, if neither is provided, the CLI prompts
for the key via masked stdin input.

**Flags**

| Flag            | Type   | Required | Default            | Description                                          |
| --------------- | ------ | -------- | ------------------ | ---------------------------------------------------- |
| `--name`        | string | no       | auto (`account-N`) | Alias for the account.                               |
| `--private-key` | string | no*      | —                  | Hex-encoded Ed25519 seed (`0x`-prefixed or raw).     |
| `--key-file`    | string | no*      | —                  | Path to a JSON file containing a `privateKey` field. |

*In `--non-interactive` mode, one of `--private-key` or `--key-file` is required.

Password is provided via `--password`, `FAST_PASSWORD` env var, or interactive
prompt (see section 3.3).

**Behavior**

1. Read the private key from the flag or prompt.
2. Validate by deriving the public key and Fast address.
3. Prompt for a password (interactive) or read from flag/env var.
4. Encrypt and store in the same format as `account create`.

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "account-1",
    "fastAddress": "fast1qw5...x9z",
    "evmAddress": "0x7a3f...b2c1"
  }
}
```

**Errors**

| Condition                                      | Exit | Code                |
| ---------------------------------------------- | ---- | ------------------- |
| Both `--private-key` and `--key-file` provided | 2    | `INVALID_USAGE`     |
| Neither flag in `--non-interactive` mode       | 2    | `MISSING_KEY`       |
| Invalid key (wrong length, not hex)            | 2    | `INVALID_KEY`       |
| Key file not found or unreadable               | 1    | `FILE_NOT_FOUND`    |
| No password in `--non-interactive` mode        | 8    | `PASSWORD_REQUIRED` |
| Name already exists                            | 2    | `ACCOUNT_EXISTS`    |

### 6.3 `fast account list`

**Synopsis**

```text
fast account list
```

**Description**

List all stored accounts with their Fast and EVM addresses.

**Output (human)**

```text
  NAME         FAST ADDRESS          EVM ADDRESS           DEFAULT
  my-account   fast1qw5...x9z       0x7a3f...b2c1         ✓
  backup       fast1ab2...y3w       0x9d1e...f4a5
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "accounts": [
      {
        "name": "my-account",
        "fastAddress": "fast1qw5...x9z",
        "evmAddress": "0x7a3f...b2c1",
        "isDefault": true
      }
    ]
  }
}
```

### 6.4 `fast account set-default`

**Synopsis**

```text
fast account set-default <name>
```

**Description**

Set the named account as the default for all signing operations.

**Arguments**

| Arg    | Type   | Required | Description                   |
| ------ | ------ | -------- | ----------------------------- |
| `name` | string | yes      | Alias of an existing account. |

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "my-account",
    "fastAddress": "fast1qw5...x9z"
  }
}
```

**Errors**

| Condition         | Exit | Code                |
| ----------------- | ---- | ------------------- |
| Account not found | 3    | `ACCOUNT_NOT_FOUND` |

### 6.5 `fast account info`

**Synopsis**

```text
fast account info [<name>]
```

**Description**

Display address details for a stored account. Defaults to the default account if
`<name>` is omitted. Does **not** show balances (use `fast info balance` for that).

**Arguments**

| Arg    | Type   | Required | Description                                     |
| ------ | ------ | -------- | ----------------------------------------------- |
| `name` | string | no       | Account alias. Defaults to the default account. |

**Output (human)**

```text
Account: my-account (default)
  Fast address: fast1qw5...x9z
  EVM address:  0x7a3f...b2c1
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "my-account",
    "fastAddress": "fast1qw5...x9z",
    "evmAddress": "0x7a3f...b2c1",
    "isDefault": true
  }
}
```

**Errors**

| Condition                           | Exit | Code                |
| ----------------------------------- | ---- | ------------------- |
| Account not found                   | 3    | `ACCOUNT_NOT_FOUND` |
| No accounts exist and no name given | 3    | `NO_ACCOUNTS`       |

### 6.6 `fast account export`

**Synopsis**

```text
fast account export [<name>]
```

**Description**

Decrypt and print the private key for a stored account. Requires the keystore
password. In interactive mode, displays a warning and requires `y/N`
confirmation before revealing the key. `--non-interactive` and `--json` skip
the confirmation.

**Arguments**

| Arg    | Type   | Required | Description                                     |
| ------ | ------ | -------- | ----------------------------------------------- |
| `name` | string | no       | Account alias. Defaults to the default account. |

**Output (human, after confirmation)**

```text
⚠ Private key for "my-account":
0x4f3a...9b1c
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "my-account",
    "privateKey": "0x4f3a...9b1c",
    "fastAddress": "fast1qw5...x9z",
    "evmAddress": "0x7a3f...b2c1"
  }
}
```

**Errors**

| Condition                               | Exit | Code                |
| --------------------------------------- | ---- | ------------------- |
| Account not found                       | 3    | `ACCOUNT_NOT_FOUND` |
| No accounts exist and no name given     | 3    | `NO_ACCOUNTS`       |
| Incorrect password                      | 8    | `WRONG_PASSWORD`    |
| No password in `--non-interactive` mode | 8    | `PASSWORD_REQUIRED` |
| User declines confirmation              | 7    | `USER_CANCELLED`    |

### 6.7 `fast account delete`

**Synopsis**

```text
fast account delete <name>
```

**Description**

Delete a stored account and its keyfile. In interactive mode, requires `y/N`
confirmation. Cannot delete the current default account unless it is the only
account remaining (in which case the default becomes `null`).

**Arguments**

| Arg    | Type   | Required | Description              |
| ------ | ------ | -------- | ------------------------ |
| `name` | string | yes      | Account alias to delete. |

**Behavior**

1. If the account is the default and other accounts exist, error with
   `DEFAULT_ACCOUNT` — user must `set-default` to another account first.
2. If the account is the default and it is the last account, proceed and set
   default to `null`.
3. In interactive mode, prompt for confirmation.
4. Remove keyfile from `~/.fast/keys/<name>.json`.
5. Remove entry from `accounts.json`.

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "old-account",
    "deleted": true
  }
}
```

**Errors**

| Condition                               | Exit | Code                |
| --------------------------------------- | ---- | ------------------- |
| Account not found                       | 3    | `ACCOUNT_NOT_FOUND` |
| Is default with other accounts existing | 2    | `DEFAULT_ACCOUNT`   |
| User declines confirmation              | 7    | `USER_CANCELLED`    |

### 6.8 `fast network list`

**Synopsis**

```text
fast network list
```

**Description**

List all available networks (bundled and custom) with their default status.

**Output (human)**

```text
  NAME       TYPE      DEFAULT
  mainnet    bundled   ✓
  testnet    bundled
  staging    custom
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "networks": [
      { "name": "mainnet", "type": "bundled", "isDefault": true },
      { "name": "testnet", "type": "bundled", "isDefault": false },
      { "name": "staging", "type": "custom", "isDefault": false }
    ]
  }
}
```

### 6.9 `fast network set-default`

**Synopsis**

```text
fast network set-default <name>
```

**Description**

Set the default network used when `--network` is not specified.

**Arguments**

| Arg    | Type   | Required | Description                                            |
| ------ | ------ | -------- | ------------------------------------------------------ |
| `name` | string | yes      | Network name (`testnet`, `mainnet`, or a custom name). |

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "testnet"
  }
}
```

**Errors**

| Condition         | Exit | Code                |
| ----------------- | ---- | ------------------- |
| Network not found | 2    | `NETWORK_NOT_FOUND` |

### 6.10 `fast network add`

**Synopsis**

```text
fast network add <name> --config <path>
```

**Description**

Add a custom network from a JSON config file. The file is copied to
`~/.fast/networks/<name>.json`. Cannot overwrite `testnet` or `mainnet`.

**Arguments**

| Arg    | Type   | Required | Description                  |
| ------ | ------ | -------- | ---------------------------- |
| `name` | string | yes      | Name for the custom network. |

**Flags**

| Flag       | Type   | Required | Default | Description                                                    |
| ---------- | ------ | -------- | ------- | -------------------------------------------------------------- |
| `--config` | string | yes      | —       | Path to network config JSON file (see section 3.5 for format). |

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "staging",
    "chains": ["arbitrum-sepolia"]
  }
}
```

**Errors**

| Condition                        | Exit | Code             |
| -------------------------------- | ---- | ---------------- |
| Name is `testnet` or `mainnet`   | 2    | `RESERVED_NAME`  |
| Name already exists              | 2    | `NETWORK_EXISTS` |
| Config file not found or invalid | 2    | `INVALID_CONFIG` |

### 6.11 `fast network remove`

**Synopsis**

```text
fast network remove <name>
```

**Description**

Remove a custom network. Cannot remove `testnet` or `mainnet`. Cannot remove
the current default network — use `set-default` first.

**Arguments**

| Arg    | Type   | Required | Description                           |
| ------ | ------ | -------- | ------------------------------------- |
| `name` | string | yes      | Name of the custom network to remove. |

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "name": "staging",
    "removed": true
  }
}
```

**Errors**

| Condition                      | Exit | Code                |
| ------------------------------ | ---- | ------------------- |
| Name is `testnet` or `mainnet` | 2    | `RESERVED_NAME`     |
| Network not found              | 2    | `NETWORK_NOT_FOUND` |
| Is current default             | 2    | `DEFAULT_NETWORK`   |

### 6.12 `fast info status`

**Synopsis**

```text
fast info status
```

**Description**

Show the health and configuration of the current network (or the one specified
by `--network`). Checks Fast RPC connectivity and AllSet bridge infrastructure.

**Output (human)**

```text
Network: mainnet (default)
  Fast RPC:      https://rpc.fast.xyz        ✓ healthy
  Explorer:      https://explorer.fast.xyz
  Block height:  1234567
  AllSet:        operational
  Chains:        base, arbitrum
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "network": "mainnet",
    "fast": {
      "rpcUrl": "https://rpc.fast.xyz",
      "explorerUrl": "https://explorer.fast.xyz",
      "healthy": true,
      "blockHeight": 1234567
    },
    "allset": {
      "status": "operational",
      "crossSignUrl": "https://cross-sign.allset.fast.xyz",
      "chains": ["base", "arbitrum"]
    }
  }
}
```

**Errors**

| Condition       | Exit | Code            |
| --------------- | ---- | --------------- |
| RPC unreachable | 5    | `NETWORK_ERROR` |

### 6.13 `fast info balance`

**Synopsis**

```text
fast info balance [--address <fast-address>] [--token <value>]
```

**Description**

Show token balances. With no flags, shows all token balances for the default
account. `--address` queries any Fast address without needing a stored account.
`--token` filters to a single token.

**Flags**

| Flag        | Type   | Required | Default                        | Description                                                         |
| ----------- | ------ | -------- | ------------------------------ | ------------------------------------------------------------------- |
| `--address` | string | no       | default account's Fast address | Any Fast address (`fast1...`) to query.                             |
| `--token`   | string | no       | *(all tokens)*                 | Filter by token. See [Token Resolution](#7-token-resolution-rules). |

**Underlying SDK call:** `FastProvider.getAccountInfo({ sender })` — reads
`token_balance` from the response.

**Output (human)**

```text
Balances for fast1qw5...x9z

  TOKEN    BALANCE         TOKEN ID
  USDC     125.50          0xc655a123...
  FAST     1,000.00        0x0000...0001
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "address": "fast1qw5...x9z",
    "balances": [
      {
        "tokenName": "USDC",
        "tokenId": "0xc655a123...",
        "amount": "125500000",
        "decimals": 6,
        "formatted": "125.50"
      }
    ]
  }
}
```

**Errors**

| Condition                     | Exit | Code              |
| ----------------------------- | ---- | ----------------- |
| No account and no `--address` | 3    | `NO_ACCOUNTS`     |
| Invalid address format        | 2    | `INVALID_ADDRESS` |
| Token not found               | 2    | `TOKEN_NOT_FOUND` |
| RPC unreachable               | 5    | `NETWORK_ERROR`   |

### 6.14 `fast info tx`

**Synopsis**

```text
fast info tx <hash> [--source <source>]
```

**Description**

Look up a single transaction by its hash. The `--source` flag specifies where
to query; if missing, then it uses the default Fast network. 
Returns the same transaction object shape as items in
`fast info history`.

**Arguments**

| Arg    | Type   | Required | Description             |
| ------ | ------ | -------- | ----------------------- |
| `hash` | string | yes      | Transaction hash (hex). |

**Flags**

| Flag       | Type   | Required | Default | Description                                                                                                                                                                      |
| ---------- | ------ | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--source` | string | yes      | —       | Where to look up the transaction. `fast` for Fast-native transactions, or a chain name (`base`, `arbitrum`, `ethereum-sepolia`, `arbitrum-sepolia`) for bridge/EVM transactions. |

**Underlying SDK calls:** When `--source fast`,
`FastProvider.getTransactionCertificates()`. When `--source <chain>`, AllSet
relayer lookup for that chain.

**Output (`--json`)**

The `data` field contains a single transaction object, identical in shape to
the items in `fast info history`'s `transactions` array:

```json
{
  "ok": true,
  "data": {
    "hash": "0xabc123...",
    "type": "transfer",
    "from": "fast1qw5...x9z",
    "to": "fast1ab2...y3w",
    "amount": "10000000",
    "formatted": "10.00",
    "tokenName": "USDC",
    "tokenId": "0xc655a123...",
    "sourceChain": "fast",
    "destChain": "fast",
    "status": "confirmed",
    "timestamp": "2026-03-31T12:00:00Z",
    "explorerUrl": "https://explorer.fast.xyz/tx/0xabc123..."
  }
}
```

**Errors**

| Condition                    | Exit | Code                |
| ---------------------------- | ---- | ------------------- |
| `--source` not provided      | 2    | `INVALID_USAGE`     |
| Transaction not found        | 1    | `TX_NOT_FOUND`      |
| Invalid hash format          | 2    | `INVALID_HASH`      |
| Unsupported `--source` value | 2    | `UNSUPPORTED_CHAIN` |
| RPC unreachable              | 5    | `NETWORK_ERROR`     |

### 6.15 `fast info history`

**Synopsis**

```text
fast info history [--from <name|address>] [--to <address>] [--source <chain>]
                  [--dest <chain>] [--token <value>] [--limit <n>]
                  [--offset <n>]
```

**Description**

Show transaction history, merging Fast-native transfers and AllSet bridge
operations. Results are ordered by timestamp descending.

**Flags**

| Flag       | Type    | Required | Default      | Description                                                         |
| ---------- | ------- | -------- | ------------ | ------------------------------------------------------------------- |
| `--from`   | string  | no       | all accounts | Filter by sender account name or address.                           |
| `--to`     | string  | no       | —            | Filter by recipient (Fast or EVM address).                          |
| `--source` | string  | no       | —            | Filter by source network/chain.                                     |
| `--dest`   | string  | no       | —            | Filter by destination network/chain.                                |
| `--token`  | string  | no       | —            | Filter by token. See [Token Resolution](#7-token-resolution-rules). |
| `--limit`  | integer | no       | `20`         | Max number of records to return.                                    |
| `--offset` | integer | no       | `0`          | Number of records to skip. Use with `--limit` for pagination.       |

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "transactions": [
      {
        "hash": "0xabc123...",
        "type": "transfer",
        "from": "fast1qw5...x9z",
        "to": "fast1ab2...y3w",
        "amount": "10000000",
        "formatted": "10.00",
        "tokenName": "USDC",
        "tokenId": "0xc655a123...",
        "sourceChain": "fast",
        "destChain": "fast",
        "status": "confirmed",
        "timestamp": "2026-03-31T12:00:00Z",
        "explorerUrl": "https://explorer.fast.xyz/tx/0xabc123..."
      }
    ]
  }
}
```

**Errors**

| Condition                                    | Exit | Code                |
| -------------------------------------------- | ---- | ------------------- |
| Account alias not found (`--from`)           | 3    | `ACCOUNT_NOT_FOUND` |
| Invalid address format (`--from` and `--to`) | 2    | `INVALID_ADDRESS`   |
| Token not found (`--token`)                  | 2    | `TOKEN_NOT_FOUND`   |
| RPC unreachable                              | 5    | `NETWORK_ERROR`     |

### 6.16 `fast info bridge-tokens`

_Note:_ Just USDC as the only bridge token. 

**Synopsis**

```text
fast info bridge-tokens
```

**Description**

List tokens that can be bridged between Fast and EVM chains via AllSet on the
current network, with their IDs, symbols, decimals, and mapped EVM contract
addresses per chain.

**Underlying SDK call:** `AllSetProvider.getNetworkConfig()`.

**Output (human)**

```text
Bridgeable tokens on mainnet:

  SYMBOL   TOKEN ID         DECIMALS   CHAINS
  USDC     0xc655a123...      6          base (0x8335...), arbitrum (0xaf88...)
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "tokens": [
      {
        "symbol": "USDC",
        "tokenId": "0xc655a123...",
        "decimals": 6,
        "chains": [
          { "chain": "base", "evmAddress": "0x8335..." },
          { "chain": "arbitrum", "evmAddress": "0xaf88..." }
        ]
      }
    ]
  }
}
```

### 6.17 `fast info bridge-chains`

**Synopsis**

```text
fast info bridge-chains
```

**Description**

List EVM chains supported for bridging via AllSet on the current network, with
chain IDs, bridge contract addresses, and bridgeable tokens.

**Underlying SDK call:** `AllSetProvider.getNetworkConfig()`.

**Output (human)**

```text
Supported bridge chains on mainnet:

  CHAIN      CHAIN ID   BRIDGE CONTRACT     TOKENS
  base       8453       0x8677...           USDC
  arbitrum   42161      0x8677...           USDC
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "chains": [
      {
        "name": "base",
        "chainId": 8453,
        "bridgeContract": "0x8677...",
        "tokens": ["USDC"]
      },
      {
        "name": "arbitrum",
        "chainId": 42161,
        "bridgeContract": "0x8677...",
        "tokens": ["USDC"]
      }
    ]
  }
}
```

### 6.18 `fast fund`

Fund a Fast account via fiat on-ramp or crypto bridge.

#### 6.18.1 `fast fund fiat`

**Synopsis**

```text
fast fund [--address <fast-address>] [--token <value>] [--provider <provider>]
```

**Description**

Generate a funding URL where the user can acquire tokens on Fast via credit card
or bank transfer (on-ramp).

**Flags**

| Flag         | Type   | Required | Default                        | Description                                                       |
| ------------ | ------ | -------- | ------------------------------ | ----------------------------------------------------------------- |
| `--address`  | string | no       | default account's Fast address | Fund to a specific Fast address.                                  |
| `--token`    | string | no       | `USDC`                         | Token to fund. See [Token Resolution](#7-token-resolution-rules). |
| `--provider` | string | no       | `swapper`                      | On-ramp provider.                                                 |

**Output (human)**

```text
Fund USDC to fast1qw5...x9z via Swapper:
  https://ramp.fast.xyz/...
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "url": "https://ramp.fast.xyz/...",
    "provider": "swapper",
    "address": "fast1qw5...x9z",
    "tokenName": "USDC"
  }
}
```

**Errors**

| Condition                     | Exit | Code                   |
| ----------------------------- | ---- | ---------------------- |
| No account and no `--address` | 3    | `NO_ACCOUNTS`          |
| Invalid address format        | 2    | `INVALID_ADDRESS`      |
| Unsupported provider          | 2    | `UNSUPPORTED_PROVIDER` |

#### 6.18.2 `fast fund crypto`

**Synopsis**

```text
fast fund crypto <amount> --chain <chain> [--token <value>]
```

**Description**

Fund a Fast account by bridging tokens from an EVM chain. 
The CLI checks the EVM balance of the account's derived EVM address 
(same underlying key) on the specified chain.
- f the EVM balance is sufficient: bridge the requested amount to Fast
automatically.
- If the EVM balance is insufficient: print the EVM address and the shortfall
amount, then exit. The user (or a human) sends the required tokens to that
address on the specified chain, then re-runs the same command.

**Arguments**

| Arg    | Type   | Required | Description                                   |
| ------ | ------ | -------- | --------------------------------------------- |
| amount | string | yes      | Human-readable amount to fund (e.g., 100.00). |


**Flags**
| Flag    | Type   | Required | Default         | Description                                                    |
| ------- | ------ | -------- | --------------- | -------------------------------------------------------------- |
| --chain | string | yes      | --              | EVM chain to bridge from. Values from fast info bridge-chains. |
| --token | string | no       | USDC / testUSDC | Token to bridge. See Token Resolution.                         |

**Behavior**
1. Check the token balance on --chain for the (derived) EVM address.
2. If balance >= amount: execute `fast send` and bridge tokens to Fast. 
3. If balance < amount: print the shortfall and the EVM address. Exit with
code 4 and error code FUNDING_REQUIRED.
If balance >= amount, the above should not require any human intervention (like entering password).

### 6.19 `fast send`

**Synopsis**

```text
fast send <address> <amount> [--from-chain <chain>] [--to-chain <chain>]
                              [--token <value>]
```

**Description**

Send tokens. The CLI auto-detects the transfer direction based on address format
and chain flags.

**Arguments**

| Arg       | Type   | Required | Description                                                                                   |
| --------- | ------ | -------- | --------------------------------------------------------------------------------------------- |
| `address` | string | yes      | Recipient address (`fast1...` for Fast, `0x...` for EVM).                                     |
| `amount`  | string | yes      | Human-readable amount (e.g., `10.5`). Converted to smallest units using the token's decimals. |

If the amount has more decimal places than the token supports, the CLI exits
with code 2 (`INVALID_AMOUNT`): `"Amount has too many decimal places for <token-symbol> (max <decimal>])."`

**Flags**

| Flag           | Type   | Required | Default | Description                                                                                                                                                                                                                                                                    |
| -------------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--from-chain` | string | no       | —       | Source chain for bridge-in. Must be a chain from `fast info bridge-chains`.                                                                                                                                                                                                    |
| `--to-chain`   | string | no       | —       | Destination chain for bridge-out. Must be a chain from `fast info bridge-chains`.                                                                                                                                                                                              |
| `--token`      | string | no       | `USDC`  | Token to send. See [Token Resolution](#7-token-resolution-rules). Default is `USDC`. For Fast→Fast transfers, any token on the Fast network is supported (not limited to bridge tokens). For bridge operations, only tokens listed in `fast info bridge-tokens` are supported. |

**Routing Rules**

| `--from-chain` | `--to-chain` | `address` format | Route                       | SDK method                                              |
| -------------- | ------------ | ---------------- | --------------------------- | ------------------------------------------------------- |
| *(none)*       | *(none)*     | `fast1...`       | Fast → Fast                 | `FastProvider.submitTransaction()` with `TokenTransfer` |
| set            | *(none)*     | `fast1...`       | EVM → Fast (bridge in)      | `AllSetProvider.sendToFast()`                           |
| *(none)*       | set          | `0x...`          | Fast → EVM (bridge out)     | `AllSetProvider.sendToExternal()`                       |
| set            | set          | `0x...`          | EVM → EVM (routed via Fast) | *Reserved — exit code 2 with `NOT_IMPLEMENTED`*         |

**Bridge-in source:** When `--from-chain` is set, the CLI uses the EVM address
derived from the signing account's key (see section 3.2). The sender must have
sufficient token balance at that address on the specified chain. Use
`fast account info` to see the EVM address.

**Bridge-in steps:** The CLI handles the full sequence: (1) check token
allowance for the bridge contract, (2) submit an approval transaction if
needed, (3) submit the bridge deposit. The user sees a single confirmation
prompt; the CLI manages the underlying transactions.


**Address validation rules:**

- If no chain flags and address is `0x...`: exit code 2 —
  `"EVM address requires --to-chain. Did you mean: fast send <addr> <amount> --to-chain <chain>?"`.
- If `--from-chain` and address is `0x...`: exit code 2 —
  `"Bridge-in requires a Fast recipient address (fast1...)."`.
- If `--to-chain` and address is `fast1...`: exit code 2 —
  `"Bridge-out requires an EVM recipient address (0x...)."`.

**Behavior (interactive mode)**

Before executing, display a confirmation summary:

```text
Send 10.50 USDC
  From:  my-account (fast1qw5...x9z)
  To:    fast1ab2...y3w
  Route: Fast → Fast
  Token: USDC
  Gas:   Requires ETH on base for transaction fees

Confirm? [y/N]
```

**Output (`--json`)**

```json
{
  "ok": true,
  "data": {
    "txHash": "0xabc123...",
    "from": "fast1qw5...x9z",
    "to": "fast1ab2...y3w",
    "amount": "10500000",
    "formatted": "10.50",
    "tokenName": "USDC",
    "tokenId": "0xc655a123...",
    "route": "fast",
    "explorerUrl": "https://explorer.fast.xyz/tx/0xabc123...",
    "estimatedTime": null
  }
}
```

The `route` field is one of: `"fast"`, `"bridge-in"`, `"bridge-out"`.
`estimatedTime` is a human-readable duration string (e.g., `"~2 minutes"`) for
bridge operations, `null` for Fast-to-Fast.

For `"bridge-in"`, `txHash` is the EVM deposit transaction hash on the source
chain. For `"bridge-out"`, `txHash` is the Fast-side transaction hash. In both
cases, `explorerUrl` links to the appropriate explorer for that hash.

**Completion semantics:** For Fast→Fast transfers, the command returns after
the transaction is confirmed on Fast (typically <1 second). For bridge
operations, the command returns after the initiating transaction is confirmed
on the source chain — it does **not** wait for the destination side to settle.
Use `fast info tx <hash> --source <chain>` to check bridge completion status.


**Errors**

| Condition                                    | Exit | Code                   |
| -------------------------------------------- | ---- | ---------------------- |
| Missing address or amount                    | 2    | `INVALID_USAGE`        |
| Address/flag mismatch (see rules above)      | 2    | `INVALID_ADDRESS`      |
| Insufficient balance                         | 4    | `INSUFFICIENT_BALANCE` |
| Insufficient gas on source chain (bridge-in) | 4    | `INSUFFICIENT_GAS`     |
| Amount exceeds token decimal precision       | 2    | `INVALID_AMOUNT`       |
| Amount is zero or negative                   | 2    | `INVALID_AMOUNT`       |
| Unsupported chain value                      | 2    | `UNSUPPORTED_CHAIN`    |
| Token not found                              | 2    | `TOKEN_NOT_FOUND`      |
| Both chain flags set                         | 2    | `NOT_IMPLEMENTED`      |
| Transaction rejected                         | 6    | `TX_FAILED`            |
| RPC unreachable                              | 5    | `NETWORK_ERROR`        |
| Incorrect password                           | 8    | `WRONG_PASSWORD`       |
| No password in `--non-interactive` mode      | 8    | `PASSWORD_REQUIRED`    |
| User declines confirmation                   | 7    | `USER_CANCELLED`       |

### 6.20 `fast pay`

**Synopsis**

```text
fast pay <url> [--dry-run] [--method <method>] [--header <key: value>]...
               [--body <data | @file>]
```

**Description**

Access a payment-protected resource. The CLI makes an HTTP request to the URL.
If the server responds with HTTP 402, the CLI parses the payment requirements,
executes the payment, and retries the request with proof of payment. The
response body is returned as output.

If the server does not return 402, the response is returned as-is (no payment
needed).

The CLI currently supports the x402 payment protocol. Payment type (Fast x402
or chain x402) is selected automatically based on the server's accepted options
and the account's available balances. Fast x402 is preferred when available. 

**Arguments**

| Arg   | Type   | Required | Description                            |
| ----- | ------ | -------- | -------------------------------------- |
| `url` | string | yes      | URL of the payment-protected resource. |

**Flags**

| Flag        | Type    | Required | Default | Description                                                                                                                                                      |
| ----------- | ------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run` | boolean | no       | `false` | Inspect the payment requirement without executing. Shows the cost, accepted payment options, and which option the CLI would select. Does not require a password. |
| `--method`  | string  | no       | `GET`   | HTTP method for the request.                                                                                                                                     |
| `--header`  | string  | no       | —       | Custom header in key: value format. Repeatable for multiple headers.                                                                                             |
| `--body`    | string  | no       | —       | Request body. Prefix with `@` to read from a file (e.g., `@request.json`).                                                                                       |

The paying account is selected via the global `--account <name>` flag or the
default account. Not required for `--dry-run`.

**Why --method, --header, and --body?**

The x402 protocol works by retrying the same HTTP request with payment proof
attached. The CLI must reproduce the original request exactly — including
method, headers, and body — on both the initial 402 probe and the paid retry.
Without these flags, the CLI could only access GET endpoints. Since agents
commonly pay for POST endpoints (e.g., AI inference APIs, data submission),
these flags are also included.

The @file convention on --body follows curl's established pattern. It
avoids shell escaping issues with inline JSON and handles arbitrary payload
sizes. Agents can write their request body to a temp file and pass the path —
no quoting or escaping required.

**Selection logic:** A 402 response may contain multiple accepted payment
options (the accepts array). The CLI picks the first option it can fulfill,
in priority order: Fast network first, then an EVM chain
where the user has sufficient balance, then an EVM chain with auto-bridge from
Fast. If no option can be fulfilled, exit with `INSUFFICIENT_BALANCE`.

**Auto-bridge for EVM x402:** When the payment requires an EVM chain payment
and the account's EVM balance on that chain is insufficient, the CLI
automatically bridges the shortfall from the Fast-side balance via AllSet. It
then polls the EVM balance (up to 2 minutes) until the bridged amount arrives
before signing the payment. If the Fast-side balance is also insufficient, the
command exits with `INSUFFICIENT_BALANCE`. In interactive mode, the
confirmation prompt shows when auto-bridging will occur.

**Behavior (interactive mode)**

```text
Payment required:
  Merchant: api.example.com
  Amount:   5.00 USDC
  Network:  fast-mainnet

Pay from my-account? [Y/N]
```

With auto-bridge:
```text
Payment required:
  Merchant: api.example.com
  Amount:   5.00 USDC
  Network:  base
  Note:     Insufficient USDC on base. Will auto-bridge 3.50 USDC from Fast.

Pay from my-account? [Y/N]
```

**Output (`--json`, execution)**

```json

**Output (`--json`, execution)**

```json
{
  "ok": true,
  "data": {
    "paid": true,
    "txHash": "0xdef456...",
    "amount": "5000000",
    "formatted": "5.00",
    "tokenName": "USDC",
    "recipient": "fast1merchant...",
    "paymentType": "x402",
    "network": "fast-mainnet",
    "response": {
      "statusCode": 200,
      "body": {}
    }
  }
}
```

The `response` field contains the HTTP status code and body returned by the
merchant after successful payment. The `body` is the parsed JSON response, or
a string if the response is not JSON. This is the content the agent is paying
to access.


**Output (`--json`, `--dry-run`)**

```json
{
  "ok": true,
  "data": {
    "paid": false,
    "selected": {
      "merchant": "api.example.com",
      "amount": "5000000",
      "formatted": "5.00",
      "tokenName": "USDC",
      "paymentType": "x402",
      "network": "fast-mainnet",
      "recipient": "fast1merchant..."
    },
    "accepts": [
      {
        "scheme": "exact",
        "network": "fast-mainnet",
        "maxAmountRequired": "5000000",
        "payTo": "fast1merchant...",
        "asset": "0xc655a123..."
      },
      {
        "scheme": "exact",
        "network": "base",
        "maxAmountRequired": "5000000",
        "payTo": "0x1131...4372",
        "asset": "0x8335..."
      }
    ]
  }
}
```

The `selected` field shows which option the CLI would choose (see selection
logic above). The `accepts` array shows all payment options from the merchant.
`paymentType` is one of: `"fast-x402"`, `"chain-x402"`.

**Errors**

| Condition                                                  | Exit | Code                   |
| ---------------------------------------------------------- | ---- | ---------------------- |
| Invalid or unreachable payment link                        | 2    | `INVALID_PAYMENT_LINK` |
| Insufficient balance (including after auto-bridge attempt) | 4    | `INSUFFICIENT_BALANCE` |
| Payment rejected by merchant                               | 6    | `PAYMENT_REJECTED`     |
| No accounts                                                | 3    | `NO_ACCOUNTS`          |
| Incorrect password                                         | 8    | `WRONG_PASSWORD`       |
| No password in `--non-interactive` mode                    | 8    | `PASSWORD_REQUIRED`    |
| User declines confirmation                                 | 7    | `USER_CANCELLED`       |
| RPC unreachable                                            | 5    | `NETWORK_ERROR`        |

## 7. Token Resolution Rules

The `--token <value>` flag accepts three input formats. Resolution is attempted
in order:

```text
Input value
  │
  ├─ Is 64 hex chars, or starts with "0x" and is 66 chars (32 bytes)?
  │    → Treat as Fast token ID. Normalize to 0x-prefixed.
  │
  ├─ Starts with "0x" and is 42 chars (20 bytes)?
  │    → Treat as EVM contract address. Look up in the current network's
  │      chain/token config to find the matching Fast token ID.
  │
  └─ Otherwise: treat as symbol.
       → Exact match against bundled token config for current network.
       → Case-insensitive fallback (e.g., "usdc" matches "USDC").
       → Alias normalization: "testUSDC" and "fastUSDC" → "USDC".
       → Not found? Exit code 2:
         "Unknown token '<value>'. Run `fast info bridge-tokens` to list supported tokens."
```

## 8. Network Resolution Rules

`--network <name>` selects which network configuration to use. Resolution:

1. If `--network` is provided, use that name.
2. Otherwise, use the default from `~/.fast/networks.json`.
3. If no `networks.json` exists, default is `testnet`.

Each network name maps to a complete configuration bundle covering:

- **Fast:** RPC URL, explorer URL.
- **AllSet (per chain):** cross-sign URL, bridge contract address, Fast bridge
  address, relayer URL, and token mappings (EVM address ↔ Fast token ID).

`testnet` and `mainnet` are always available with bundled configs. Custom
networks are added via `fast network add` and stored in
`~/.fast/networks/<name>.json` (see section 3.5 for format).

## 9. Supported Chains and Tokens

Reference tables reflecting the current state of `@fastxyz/allset-sdk`
configuration. These are the canonical values accepted by `--from-chain`,
`--to-chain`, and `--token`.

### Mainnet

| Chain      | Chain ID | Bridge Contract | Tokens             |
| ---------- | -------- | --------------- | ------------------ |
| `base`     | 8453     | `0x8677...`     | USDC (`0x8335...`) |
| `arbitrum` | 42161    | `0x8677...`     | USDC (`0xaf88...`) |

| Token    | Symbol | Fast Token ID   | Decimals |
| -------- | ------ | --------------- | -------- |
| USD Coin | `USDC` | `0xc655a123...` | 6        |

### Testnet

| Chain              | Chain ID | Bridge Contract | Tokens               |
| ------------------ | -------- | --------------- | -------------------- |
| `ethereum-sepolia` | 11155111 | `0xb536...`     | USDC (`0x1c7D4B...`) |
| `arbitrum-sepolia` | 421614   | `0xb536...`     | USDC (`0x75fa...`)   |

| Token         | Symbol (alias)                  | Fast Token ID   | Decimals |
| ------------- | ------------------------------- | --------------- | -------- |
| Test USD Coin | `USDC` (`testUSDC`, `fastUSDC`) | `0xd73a0679...` | 6        |

**Note:** The x402 payment protocol (`fast pay`) may encounter payment
requirements on chains not listed above (e.g., `base-sepolia`, `ethereum`).
The CLI can fulfill chain x402 payments on any EVM chain where the account's
derived EVM address has sufficient token balance. The tables above list only
chains supported for bridging via `fast send` and `fast fund crypto`.