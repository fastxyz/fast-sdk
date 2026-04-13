---
name: fast
description: >
  fast CLI for managing Fast network accounts, sending tokens, funding via bridge or fiat,
  and paying x402-protected APIs. Use when the user wants to run fast commands, create accounts,
  check balances, send USDC, or interact with the Fast network from the terminal.
---

# fast CLI

## Agent Bootstrap

**Run these steps only once per session, on the very first `fast` command, or if `fast` is not found. Skip for subsequent commands.**

```sh
# 1. Require Node.js ≥ 18
node --version   # must be v18 or higher; stop and inform the user if not

# 2. Check the latest version and what's installed
LATEST=$(npm show @fastxyz/cli version)
INSTALLED=$(fast --version 2>/dev/null || echo "none")

# 3. Install or upgrade if needed
if [ "$INSTALLED" != "$LATEST" ]; then
  npm install -g @fastxyz/cli@latest
fi

# 4. Confirm
fast --version   # should print $LATEST
```

If `fast` is still not found after install, diagnose `PATH`:

```sh
npm bin -g        # ensure this directory is on PATH
npx @fastxyz/cli@latest --version   # fallback
```

---

> **IMPORTANT — Agent rule:** Do NOT run version checks, npm install, or any shell bootstrap before every `fast` command. Only run the bootstrap above on the very first command in a session, or if `fast` is genuinely not found. For all other tasks, call the appropriate `fast` subcommand directly.

---

## Complete Command Reference

Every supported subcommand is listed below. Use **exactly** these command names — do not invent alternatives.

### `info` subcommands

| Command | Description | Key flags |
|---|---|---|
| `fast info status` | Show **network health status** for the current network | `--network <name>`, `--json` |
| `fast info balance` | Show USDC balances on Fast and bridgeable EVM chains | `--json` |
| `fast info history` | Show transaction history | `--limit <n>` (number of records), `--json` |
| `fast info tx <hash>` | Look up details for a **specific transaction** by hash | `--json` |
| `fast info bridge-chains` | List all **bridge-compatible EVM chains** | `--json` |
| `fast info bridge-tokens` | List all **bridge-compatible tokens** | `--json` |

> **`info status` vs `info balance`:** Use `info status` for *network health*. Use `info balance` for *account balances*. These are different commands.

> **`info tx` vs `info history`:** Use `info tx <hash>` to look up *one specific transaction* by hash. Use `info history` to browse *recent transactions* (with optional `--limit`).

> **`info bridge-chains` vs `info bridge-tokens`:** Use `info bridge-chains` to list which EVM chains support bridging. Use `info bridge-tokens` to list which tokens can be bridged.

### `account` subcommands

| Command | Description | Key flags / args |
|---|---|---|
| `fast account list` | List all stored accounts | `--json` |
| `fast account create` | Create a new account | `--name <alias>` (required for non-interactive), `--non-interactive` |
| `fast account set-default <name>` | Set named account as the default | — |
| `fast account export <name>` | Export the **private key** of a named account | — |
| `fast account delete <name>` | Delete (remove) a named account | — |
| `fast account import` | Import an existing key | `--name <alias>` |

> **`account delete` is the only delete command.** There is no `account remove`.
> **`account export` takes the account name as a positional argument**, not `--name`.
> **`account set-default` takes the account name as a positional argument**.

### `fund` subcommands

| Command | Description | Key flags |
|---|---|---|
| `fast fund crypto <amount>` | Bridge USDC from an EVM chain into the Fast account | `--chain <chain>` (required), `--eip-7702` (gasless) |
| `fast fund fiat` | Open a fiat on-ramp (mainnet only) | `--network mainnet` |

### `send` command

```sh
fast send <address> <amount> [--token <TOKEN>] [--from-chain <chain>] [--to-chain <chain>] [--eip-7702]
```

| Argument / Flag | Description | Allowed values |
|---|---|---|
| `<address>` | Recipient address | `fast1...` (Fast network) or `0x...` (EVM) |
| `<amount>` | Amount to send | numeric string, e.g. `"20"` |
| `--token <TOKEN>` | Token to send (**always specify explicitly**) | `USDC` (default; `testUSDC` is an alias on testnet) |
| `--from-chain <chain>` | Bridge from this EVM chain into Fast | e.g. `arbitrum-sepolia`, `base` |
| `--to-chain <chain>` | Bridge from Fast to this EVM chain | e.g. `arbitrum-sepolia` |
| `--eip-7702` | Gasless deposit (no ETH needed on EVM side) | flag, no value |

> **Always pass `--token USDC` explicitly** when bridging or sending USDC — do not rely on the default.

### `network` subcommands

| Command | Description |
|---|---|
| `fast network list` | List configured networks |
| `fast network set-default <name>` | Set the default network (`testnet` or `mainnet`) |
| `fast network add <file> --name <name>` | Add a custom network from a JSON config file; **`--name` is required** |
| `fast network remove <name>` | Remove a custom network by name |

> **`network add` requires both arguments:** the config file path (positional) AND `--name <name>` (named flag). Omitting `--name` will fail.
> **`network remove` is the correct command** to delete a network — do NOT use `network delete` or `network list`.

### `pay` command

```sh
fast pay <url> [--method <METHOD>] [--body <data|@file>] [--dry-run]
```

---

## Use Cases

**Use when:**

- Create or manage Fast accounts from the terminal
- Check token balances on Fast or EVM chains
- Send USDC between Fast addresses or bridge to/from EVM
- Fund a Fast account from crypto (bridge) or fiat (on-ramp)
- Pay a payment-protected URL (x402) using a stored account
- Configure networks or switch defaults

**Out of scope:**

- Programmatic SDK usage → use `@fastxyz/sdk` or `@fastxyz/allset-sdk`
- Protecting API routes with payments → use `@fastxyz/x402-server`
- Operations requiring custom transaction logic not exposed by the CLI

---

## Related Package References

Detailed API docs are in the monorepo. Read these files when you need package-specific details:

| Path | Package | Purpose |
|---|---|---|
| `app/cli/README.md` | `@fastxyz/cli` | CLI source — command structure and config |
| `packages/fast-sdk/README.md` | `@fastxyz/sdk` | Fast network SDK — build/sign transactions, query accounts, transfer tokens |
| `packages/allset-sdk/README.md` | `@fastxyz/allset-sdk` | Bridge SDK — EVM → Fast deposits, Fast → EVM withdrawals |
| `packages/x402-client/README.md` | `@fastxyz/x402-client` | x402 client — pay 402-protected APIs programmatically |
| `packages/x402-server/README.md` | `@fastxyz/x402-server` | x402 server — protect API routes with payment middleware |
| `packages/x402-facilitator/README.md` | `@fastxyz/x402-facilitator` | x402 facilitator — verify and settle payments |
| `packages/x402-types/README.md` | `@fastxyz/x402-types` | Shared x402 types — PaymentRequirement, PaymentPayload, network configs |
| `packages/fast-schema/README.md` | `@fastxyz/schema` | Effect schema — BCS/JSON-RPC/REST wire format codecs |

---

## Key Concepts

### Accounts

Accounts are stored in `~/.fast/`. Each account has two addresses derived from
the same Ed25519 key:

- **Fast address** (`fast1...`) — used on the Fast network
- **EVM address** (`0x...`) — the same key expressed as an Ethereum address,
  used for bridge deposits

When running `fast fund crypto` or `fast send --from-chain <chain>`, the CLI
uses the EVM address derived from the current account's key. Use
`fast account list` to see both addresses.

### Networks

Two networks are always available: `testnet` (default) and `mainnet`. Switch
with `--network mainnet` per command, or set a persistent default:

```sh
fast network set-default mainnet
```

Custom networks can be added from a JSON config file via `fast network add <file> --name <name>`. Both arguments are required. Remove a custom network with `fast network remove <name>`.

### Password

The keystore password can be provided as:

1. `--password <value>` flag
2. `FAST_PASSWORD` environment variable (**preferred** — avoids shell history exposure)
3. Interactive prompt (interactive mode only)

Accounts created in `--non-interactive` mode with no password are stored
unencrypted (file permission `0600` only, like an SSH key without a passphrase).

---

## Common Workflows

### 1. Create an account

```sh
fast account create
# → prompts for password, prints Fast + EVM address

# Non-interactive (no password, unencrypted key):
fast account create --non-interactive --name agent-wallet

# Then set it as default:
fast account set-default agent-wallet
```

### 2. Check balances

```sh
fast info balance
fast info balance --json   # machine-readable
```

`fast info balance` shows balances on Fast **and** on each bridgeable EVM chain.

### Check network health status

```sh
fast info status        # ← use THIS for network health, NOT info balance
fast info status --json
```

### Look up a transaction

```sh
fast info tx 0xabc123def456        # ← use THIS for a specific tx hash
fast info history                  # ← use THIS for recent tx list
fast info history --limit 10       # last 10 records
```

### List bridge-compatible chains and tokens

```sh
fast info bridge-chains    # ← lists which EVM chains support bridging
fast info bridge-tokens    # ← lists which tokens can be bridged
```

### Add and remove custom networks

```sh
# Add — BOTH the file path AND --name are required:
fast network add /etc/fast/custom-net.json --name custom-testnet

# Remove — use 'network remove', NOT 'network delete':
fast network remove custom-testnet
```

### Account management

```sh
fast account export my-wallet      # export private key of 'my-wallet'
fast account delete old-wallet     # delete account named 'old-wallet' (NOT 'account remove')
fast account set-default my-wallet # set 'my-wallet' as default
```

### 3. Send USDC (Fast → Fast)

```sh
fast send fast1ab2...y3w 10.5
```

### 4. Fund from EVM → Fast (`fast fund crypto`)

```sh
fast fund crypto 50 --chain arbitrum-sepolia
```

**What happens:**

1. Checks ERC-20 balance on `arbitrum-sepolia` for the account's EVM address.
2. If sufficient: executes bridge deposit automatically.
3. If insufficient: prints the EVM address and shortfall, exits with code 4
   (`FUNDING_REQUIRED`). Send tokens to that address first, then re-run.

> Find your EVM address with `fast account list`.

#### Gasless variant with EIP-7702 (no ETH needed)

```sh
fast fund crypto 50 --chain base --eip-7702
```

Gas is paid in USDC instead of ETH. Approve + deposit are batched into a single
UserOperation via the AllSet Portal and Pimlico.

### 5. Bridge USDC from Fast → EVM

```sh
fast send 0xYourEvmAddress 25 --token USDC --to-chain arbitrum-sepolia
```

### 6. Fund via fiat (mainnet only)

```sh
fast fund fiat --network mainnet
# → prints an on-ramp URL
```

### 7. Pay an x402-protected URL

```sh
fast pay https://api.example.com/resource

# POST with a body:
fast pay https://api.example.com/resource --method POST --body @request.json

# Inspect without paying:
fast pay https://api.example.com/resource --dry-run
```

---

## Common Pitfalls

### Fast address vs. EVM address — same key, different format

The `fast1...` and `0x...` addresses shown by `fast account list` are both
derived from the **same private key**. You do not need a separate EVM wallet.
When depositing via a bridge UI or another wallet, use the EVM address from
`fast account list`.

### `fast fund crypto` vs. `fast send --from-chain`

| Command | Use when |
|---|---|
| `fast fund crypto <amount> --chain <chain>` | Top up your own Fast account from your own EVM balance |
| `fast send <fast-address> <amount> --from-chain <chain>` | Bridge from EVM to an arbitrary Fast recipient |

### Token names: `USDC` vs. `testUSDC`

On testnet, `USDC` and `testUSDC` both resolve to the same token.
On mainnet, only `USDC` is valid.

### Bridge direction flags

| You want | Command |
|---|---|
| EVM → Fast (standard) | `fast send <fast1-address> <amount> --token USDC --from-chain <chain>` |
| EVM → Fast (gasless, no ETH) | `fast send <fast1-address> <amount> --token USDC --from-chain <chain> --eip-7702` |
| Fast → EVM | `fast send <0x-address> <amount> --token USDC --to-chain <chain>` |
| EVM → EVM | Not supported (`NOT_IMPLEMENTED`) |

The address format determines direction: `0x` recipient → Fast→EVM; `fast1`
recipient with `--from-chain` → EVM→Fast.

### `--eip-7702` flag: when to use it

Use with EVM→Fast commands when the EVM account has no ETH — gas is deducted
in USDC instead. Ignored for Fast→Fast or Fast→EVM routes.

---

## Global Flags

| Flag | Description |
|---|---|
| `--json` | Machine-readable JSON output (also suppresses prompts) |
| `--non-interactive` | No prompts; fails with exit code 2 when input is missing |
| `--network <name>` | Override network (`testnet`, `mainnet`, or a custom name) |
| `--account <name>` | Use a specific stored account |
| `--password <value>` | Keystore password (prefer `FAST_PASSWORD` env var) |
| `--debug` | Verbose logging to stderr |

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Invalid usage / bad arguments |
| 3 | Account not found |
| 4 | Insufficient balance / funding required |
| 5 | Network error |
| 6 | Transaction failed |
| 7 | User cancelled |
| 8 | Password required or incorrect |

---

## JSON Output Shape

All commands with `--json` return a consistent envelope:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

Agent workflow: run with `--json` → check `ok` → if false, branch on `error.code`.