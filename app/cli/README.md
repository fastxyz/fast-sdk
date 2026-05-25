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

# Send the network's default token (fastUSD on mainnet) — Fast → Fast
fast send fast1abc...xyz 10

# Send a specific token explicitly
fast send fast1abc...xyz 10 --token USDC

# Bridge USDC from Arbitrum Sepolia to Fast (--token USDC is required on
# mainnet because the network default — fastUSD — is not on EVM chains)
fast fund usdc crypto 50 --chain arbitrum-sepolia --token USDC

# Or get a unified Fast web-app URL to fund fastUSD (mainnet only)
fast fund fastusd --amount 50

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

### Default token

Commands that accept `--token` (currently `fast send` and `fast fund usdc
crypto`) default to the active network's `defaultToken.symbol` when the flag
is omitted: `fastUSD` on mainnet, `testUSDC` on testnet. Bridge routes
additionally require the resolved token to exist on the target chain — on
mainnet bridges you must pass `--token USDC` explicitly because `fastUSD` does
not exist on EVM chains.

To customize the default, register a network with `fast network add <name>
--config <path>` where the JSON config includes a `defaultToken` field, for
example:

```json
{
  "defaultToken": {
    "symbol": "USDC",
    "tokenId": "0x...",
    "decimals": 6
  }
}
```

If a custom network omits `defaultToken`, callers must pass `--token`
explicitly; otherwise the command errors with `INVALID_USAGE`.

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
- `--token <token>` — Token symbol or token ID. Defaults to the network's `defaultToken.symbol` (`fastUSD` on mainnet, `testUSDC` on testnet). Bridge routes require the resolved token to be available on the target chain; otherwise the command errors with `CommandUnsupportedForTokenError`.
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

### `fast fund usdc fiat`

Get a fiat on-ramp URL for funding a Fast address with USDC. The URL targets
[ramp.fast.xyz](https://ramp.fast.xyz); the deposit lands on Fast as bridged
USDC, distinct from the Fast-native `fastUSD`.

```bash
fast fund usdc fiat --network mainnet
```

**Requirements:**

- Mainnet only (Ramp does not support testnet).
- Active account or `--address <fast1...>`.

---

### `fast fund usdc crypto <amount>`

Bridge USDC from an EVM chain to the Fast network. The deposit lands as
bridged USDC on Fast (distinct from `fastUSD`).

```bash
fast fund usdc crypto 10.5 --chain arbitrum-sepolia --token USDC
```

**Positional arguments:**

- `<amount>` — Human-readable amount to bridge (e.g., `10.5`).

**Options:**

- `--chain <chain>` — Source EVM chain (required).
- `--token <token>` — Token symbol or token ID. Defaults to the network's `defaultToken.symbol`. On mainnet that's `fastUSD`, which is **not** on EVM chains — pass `--token USDC` explicitly for the bridge case, or the command errors with `CommandUnsupportedForTokenError`.
- `--eip-7702` — Use the smart deposit flow (gas paid in USDC via paymaster).

---

### `fast fund fastusd`

Print an `app.fast.xyz/send` URL that opens the unified Fast web app to fund
your account with **fastUSD** (a Fast-native token, separate from bridged USDC).
The web app handles fiat-onramp, crypto-bridge, and wallet-to-wallet funding
under the hood; the CLI's job is just to produce the URL.

```bash
fast fund fastusd
# → https://app.fast.xyz/send?to=fast1...

fast fund fastusd --amount 25
# → https://app.fast.xyz/send?to=fast1...&amount=25

fast fund fastusd --to fast1someoneelse --amount 10
# → https://app.fast.xyz/send?to=fast1someoneelse&amount=10
```

**Options:**

- `--to <fast1...>` — Recipient Fast address (default: active account).
- `--amount <decimal>` — Optional amount; if omitted, the web app prompts.

**Requirements:**

- Mainnet only.

---

### `fast authorize request`

Generate a one-time HPKE authorization request. The command creates a URL for the wallet user to open, and stores a short-lived key in `~/.fast/handover-pending.json` (mode 0600, up to 5 minutes).

```bash
fast authorize request [--requester NAME] [--url URL]
```

**Options:**

- `--requester <name>` — Optional label shown to the wallet user to identify who is requesting
- `--url <url>` — Override the wallet base URL the auth link points to (default: `https://app.fast.xyz/authorize`). Useful for local dev against a non-production wallet, e.g. `--url http://localhost:3000/authorize`.

**Output (human):**

```
Authorization URL:
  https://app.fast.xyz/authorize?data=eyJ...

Fingerprint:    123456
Expires at:     2026-05-25T12:05:00Z

Show the URL to the wallet user. Once they paste back the handover
code, run:
  fast authorize complete --message '<paste here>'
```

**Output (`--json`):**

```json
{
  "auth_url": "...",
  "request_fingerprint": "123456",
  "request_expires_at": "2026-05-25T12:05:00Z"
}
```

**Security note:** `~/.fast/handover-pending.json` contains the HPKE one-time private key — not the account seed. An attacker who steals only this file cannot derive the account key; they would also need to intercept the handover code the wallet user pastes back. The file expires within 5 minutes and is deleted after a successful `authorize complete`.

---

### `fast authorize complete`

Decrypt a handover code returned by the wallet user and print the account private key to stdout.

```bash
fast authorize complete [--message TEXT | --stdin] [--print-account] [--json]
```

**Options:**

- `--message <text>` — Handover code or chat message containing it (bare base64url or quoted)
- `--stdin` — Read the handover code from stdin (e.g., `cat code.txt | fast authorize complete --stdin`)
- `--print-account` — Also print the derived Fast address and public key
- `--json` — Emit JSON output

If neither `--message` nor `--stdin` is provided, the CLI prompts interactively. With `--non-interactive`, absence of both flags is an error.

**Output (human, default):**

```
0x1313131313131313131313131313131313131313131313131313131313131313
```

**Output (human, `--print-account`):**

```
Private key:     0x1313...
Address:         fast1abc...xyz
Public key:      0xdead...beef
```

**Output (`--json`):**

```json
{ "private_key": "0x1313..." }
```

After a successful decryption, `~/.fast/handover-pending.json` is deleted. On decryption failures, the state file is updated (or deleted after 3 attempts) so the same request may be retried.

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

# 2. Get a fiat on-ramp URL (delivers USDC to your Fast account)
fast fund usdc fiat --network mainnet --address fast1...

# 2b. Or open the unified Fast web app to fund fastUSD
fast fund fastusd --network mainnet

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
