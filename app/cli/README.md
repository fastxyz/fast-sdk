# @fastxyz/fast-cli

Fast CLI for account management, token transfers, network queries, and x402 payments.

## What this package does

The Fast CLI is the primary way to interact with the Fast network from the terminal. It provides commands for:

- **Account management** — create, import, list, export, and delete accounts stored in a local SQLite database
- **Balance and info queries** — check account balances, transaction history, token info, and network status
- **Token transfers** — send tokens on the Fast network to other addresses
- **Fiat on-ramps** — fund your account using fiat currency (USD/EUR) via MoonPay
- **Crypto on-ramps** — bridge crypto from EVM chains to the Fast network
- **x402 payments** — pay for HTTP resources that require x402 payment

All account keys are encrypted at rest using a password-derived key (PBKDF2). The CLI stores data in `~/.fast/fast.db`.

## Installation

```bash
npm install -g @fastxyz/fast-cli
```

Or use via pnpm in the repo:

```bash
pnpm cli --help
```

## Global Options

These options work with every command:

| Option | Description |
|--------|-------------|
| `--json` | Emit machine-readable JSON output instead of human-readable text |
| `--network <name>` | Override the active network (`mainnet`, `testnet`) for this command |
| `--account <name>` | Use a specific named account instead of the default |
| `--password <pwd>` | Provide the keystore password (defaults to `FAST_PASSWORD` env var, then interactive prompt) |
| `--non-interactive` | Fail when input is required instead of prompting |
| `--debug` | Enable verbose debug logging to stderr |

## Commands

### `fast account create`

Create a new Ed25519 account and store it encrypted in the local keystore.

```bash
fast account create --name my-account
```

**Options:** `--name <alias>` — Optional human-readable alias for the account.

Uses the default network unless `--network` is specified. Prompts for a keystore password if `--password` is not given and `FAST_PASSWORD` is unset.

---

### `fast account import`

Import an existing account from a 32-byte hex private key.

```bash
fast account import --name my-imported-account
# You'll be prompted for the private key
```

**Options:** `--name <alias>` — Required alias for the imported account.

---

### `fast account list`

List all stored accounts with their addresses and default status.

```bash
fast account list
```

---

### `fast account export`

Export an account's private key (requires password).

```bash
fast account export --name my-account
```

---

### `fast account set-default`

Set the default account for commands that need a signer.

```bash
fast account set-default --name my-account
```

---

### `fast account delete`

Delete an account from the local keystore.

```bash
fast account delete --name my-account
```

---

### `fast send <address> <amount>`

Send tokens to a recipient address on the Fast network.

```bash
fast send fast1recipient... 1000 --token 0x11...
```

**Positional arguments:**
- `<address>` — Recipient Fast address (bech32m format)
- `<amount>` — Amount in smallest token units (not human-readable)

**Options:**
- `--from-chain <chain>` — Source chain (for cross-chain sends)
- `--to-chain <chain>` — Destination chain
- `--token <address>` — Token ID or contract address (defaults to native token)
- `--account <name>` — Sender account (defaults to the configured default)

---

### `fast info balance`

Check the native token and USDC balance for an address or account.

```bash
# By address
fast info balance --address fast1...

# By account name
fast info balance --account my-account

# For a specific token
fast info balance --address fast1... --token 0x11...
```

---

### `fast info status`

Check the current network status — block height, epoch info, and validator state.

```bash
fast info status
```

---

### `fast info tx <hash>`

Look up a transaction by its hash and display its status, events, and certificates.

```bash
fast info tx 0xabc123...
```

**Options:** `--source <provider>` — Override the RPC provider.

---

### `fast info history`

Show recent transaction history for an address or account.

```bash
fast info history --address fast1... --limit 20
```

---

### `fast info bridge-chains`

List EVM chains available for bridging via AllSet and their current status.

```bash
fast info bridge-chains
```

---

### `fast info bridge-tokens`

List tokens available for bridging via AllSet and their Fast/EVM configurations.

```bash
fast info bridge-tokens
```

---

### `fast fund fiat`

Open an interactive fiat on-ramp (via MoonPay) to fund your Fast account using USD or EUR.

```bash
fast fund fiat --network mainnet
```

**Requirements:**
- Only available on `mainnet`
- Opens MoonPay in your browser for KYC and payment

**Options:**
- `--address <fast-address>` — Fund a specific Fast address directly (skips account prompt)
- `--network <name>` — Must be `mainnet`

---

### `fast fund crypto <amount>`

Bridge crypto from an EVM chain to the Fast network via AllSet.

```bash
fast fund crypto 1000000 --chain arbitrum-sepolia --token 0x75fa...
```

**Positional arguments:**
- `<amount>` — Amount in smallest token units

**Options:**
- `--chain <chain>` — Source EVM chain (required)
- `--token <address>` — Token address on the source chain (defaults to USDC if available)
- `--account <name>` — Your Fast account to receive the bridged tokens

---

### `fast pay <url>`

Pay for an x402-protected HTTP resource. The CLI handles the 402 response, signs and submits payment, and retries the request automatically.

```bash
fast pay https://api.example.com/premium
```

**Positional arguments:**
- `<url>` — URL of the x402-protected resource (required)

**Options:**
- `--dry-run` — Show payment details without actually paying
- `--method <GET|POST|...>` — HTTP method (default: GET)
- `--header <key:value>` — Custom request header (can be repeated)
- `--body <data>` — Request body (use `@filepath` to read from a file)
- `--network <name>` — Network to use for payment

**Example with headers and body:**

```bash
fast pay https://api.example.com/analyze \
  --method POST \
  --header "Content-Type: application/json" \
  --body '{"text": "hello world"}'
```

---

### `fast network list`

List all configured networks and show which one is the current default.

```bash
fast network list
```

---

### `fast network add <name>`

Add a custom network configuration by name.

```bash
fast network add my-custom-net --config ./network-config.json
```

**Positional arguments:**
- `<name>` — Unique name for the network

**Options:**
- `--config <path>` — Path to a JSON file with the network configuration (required)

---

### `fast network set-default`

Set the default network for all subsequent commands.

```bash
fast network set-default testnet
```

---

### `fast network remove`

Remove a previously added network configuration.

```bash
fast network remove my-custom-net
```

---

## Configuration Files

The CLI stores data in `~/.fast/`:

```
~/.fast/
  fast.db          # SQLite database (accounts, networks, history)
  keystore/        # Encrypted private key files (one per account)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FAST_PASSWORD` | Default keystore password (avoids interactive prompt) |
| `FAST_NETWORK` | Default network name |
| `FAST_ACCOUNT` | Default account name |

## Examples

### Full workflow: fund, check balance, and send

```bash
# 1. Create an account
fast account create --name my-account

# 2. Fund via fiat on-ramp (opens browser)
fast fund fiat --network mainnet --address fast1...

# 3. Check your balance
fast info balance --account my-account

# 4. Send tokens to someone
fast send fast1recipient... 1000000 --account my-account --token 0x11...
```

### Pay for an x402-protected API

```bash
# Simple GET request
fast pay https://api.example.com/premium

# POST with JSON body
fast pay https://api.example.com/analyze \
  --method POST \
  --header "Authorization: Bearer $API_KEY" \
  --body '{"query": "summarize this text"}'

# Dry run to see payment details first
fast pay https://api.example.com/premium --dry-run
```

## See Also

- Root [README](../README.md) for monorepo overview
- [@fastxyz/sdk](../packages/fast-sdk/README.md) for SDK documentation — the CLI uses this internally for signing and RPC
- [@fastxyz/allset-sdk](../packages/allset-sdk/README.md) for bridging details
- [Fast Documentation](https://docs.fast.xyz) for protocol-level details
