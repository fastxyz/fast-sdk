# fast CLI

A command-line tool for the [Fast network](https://fast.xyz) — manage accounts, send USDC, bridge tokens between EVM chains and Fast, fund via fiat, and pay x402-protected APIs.

## Installation

**Requires Node.js 18+**

```bash
pnpm install -g @fastxyz/cli
```

Or use via pnpm in the repo:

```bash
pnpm cli --help
```

Verify:

```bash
fast --version
fast --help
```

## Quick Start

```bash
# Create an account
fast account create

# Check balances
fast info balance

# Send USDC
fast send fast1abc...xyz 10

# Bridge from Arbitrum Sepolia to Fast
fast fund crypto 50 --chain arbitrum-sepolia

# Pay an x402-protected API
fast pay https://api.example.com/resource
```

## Environment

| Variable        | Description                                          |
| --------------- | ---------------------------------------------------- |
| `FAST_PASSWORD` | Keystore password (preferred over `--password` flag) |

## AI Agent Skill

Install the skill to let AI agents operate the `fast` CLI on your behalf:

```bash
npx skills add https://github.com/fastxyz/fast-sdk/tree/main/skills
```

## Documentation

Full command reference and workflows: [`skills/fast/SKILL.md`](https://github.com/fastxyz/fast-sdk/tree/main/skills/fast/SKILL.md)

## Global Options

These options work with every command:

| Option | Description |
|--------|-------------|
| `--json` | Emit machine-readable JSON output instead of human-readable text |
| `--network <name>` | Override the active network (`mainnet`, `testnet`) for this command |
| `--account <name>` | Use a specific named account instead of the default |
| `--password <pwd>` | Provide the keystore password (defaults to `FAST_PASSWORD` env var, then interactive prompt) |
| `--non-interactive` | Auto-confirm confirmations and fail when required input is missing |
| `--debug` | Enable verbose debug logging to stderr |

## Commands

### `fast account create`

Create a new Ed25519 account and store it in the local keystore.

```bash
fast account create --name my-account
```

**Options:** `--name <alias>` — Optional human-readable alias for the account.

Prompts for an optional keystore password if `--password` is not given and `FAST_PASSWORD` is unset.

---

### `fast account import`

Import an existing account from a 32-byte hex private key.

```bash
fast account import --name my-imported-account --private-key 0x...
```

**Options:**
- `--name <alias>` — Optional human-readable alias for the imported account
- `--private-key <hex>` — Hex-encoded 32-byte private key
- `--key-file <path>` — Path to a JSON file containing a `privateKey` field

If `--name` is omitted, the CLI auto-generates one. You must provide exactly one of `--private-key` or `--key-file`.

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
fast account export my-account
```

If no account name is provided, the CLI exports the current default account.

---

### `fast account set-default`

Set the default account for commands that need a signer.

```bash
fast account set-default my-account
```

---

### `fast account delete`

Delete an account from the local keystore.

```bash
fast account delete my-account
```

---

### `fast send <address> <amount>`

Send tokens between Fast and supported EVM chains.

```bash
fast send fast1recipient... 10.5 --token USDC
```

**Positional arguments:**
- `<address>` — Recipient address (`fast1...` for Fast, `0x...` for EVM)
- `<amount>` — Human-readable amount (for example, `10` or `1.5`)

**Options:**
- `--from-chain <chain>` — Source EVM chain for EVM → Fast transfers
- `--to-chain <chain>` — Destination EVM chain for Fast → EVM transfers
- `--token <token>` — Token symbol or token ID (defaults to the first configured bridge token, typically `USDC`)
- `--eip-7702` — Use the smart deposit flow for EVM → Fast transfers
- `--account <name>` — Sender account (defaults to the configured default)

---

### `fast info balance`

Check balances for the current account or a named account.

```bash
# By account name
fast info balance --account my-account

# For a specific token
fast info balance --token USDC
```

---

### `fast info status`

Check the current network configuration and whether the Fast RPC is reachable.

```bash
fast info status
```

---

### `fast info tx <hash>`

Look up a transaction by hash in the local CLI history store.

```bash
fast info tx 0xabc123...
```

---

### `fast info history`

Show recent locally recorded transaction history.

```bash
fast info history --from fast1... --limit 20
```

**Options:**
- `--from <address>` — Filter by sender address
- `--to <address>` — Filter by recipient address
- `--token <token>` — Filter by token name or token ID
- `--limit <n>` — Max number of records to return
- `--offset <n>` — Number of records to skip

---

### `fast info bridge-chains`

List EVM chains available for Fast-EVM transfers.

```bash
fast info bridge-chains
```

---

### `fast info bridge-tokens`

List tokens available for Fast-EVM transfers and the chains they are configured on.

```bash
fast info bridge-tokens
```

---

### `fast fund fiat`

Get a fiat on-ramp URL for funding a Fast address.

```bash
fast fund fiat --network mainnet
```

**Requirements:**
- Only available on `mainnet`
- Prints a funding URL for you to open in your browser

**Options:**
- `--address <fast-address>` — Fund a specific Fast address directly (otherwise uses the selected account)
- `--network <name>` — Must be `mainnet`

---

### `fast fund crypto <amount>`

Bridge crypto from an EVM chain to the Fast network.

```bash
fast fund crypto 10.5 --chain arbitrum-sepolia --token USDC
```

**Positional arguments:**
- `<amount>` — Human-readable amount

**Options:**
- `--chain <chain>` — Source EVM chain (required)
- `--token <token>` — Token symbol or token ID (defaults to `USDC` / `testUSDC`)
- `--eip-7702` — Use the smart deposit flow when supported

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

**Example JSON config (`network-config.json`):**
```json
{
  "url": "https://api.fast.xyz/proxy-rest",
  "networkId": "fast:testnet",
  "chainType": "fast"
}
```

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
  fast.db          # SQLite database (accounts, networks, history, encrypted keys)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FAST_PASSWORD` | Default keystore password (avoids interactive prompt) |

## Examples

### Full workflow: fund, check balance, and send

```bash
# 1. Create an account
fast account create --name my-account

# 2. Get a fiat on-ramp URL
fast fund fiat --network mainnet --address fast1...

# 3. Check your balance
fast info balance --account my-account

# 4. Send tokens to someone
fast send fast1recipient... 1.25 --account my-account --token USDC
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
- [@fastxyz/sdk](../packages/fast-sdk/README.md) for SDK documentation — the CLI uses this internally for signing and REST API calls
- [@fastxyz/allset-sdk](../packages/allset-sdk/README.md) for bridging details
- [Fast Documentation](https://docs.fast.xyz) for protocol-level details
