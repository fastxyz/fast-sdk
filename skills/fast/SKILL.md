---
name: fast
description: >
  fast CLI for managing Fast network accounts, sending tokens, funding via bridge or fiat,
  and paying x402-protected APIs. Use when the user wants to run fast commands, create accounts,
  check balances, send USDC, request a payment (get paid), or interact with the Fast network from the terminal.
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
| `fast info history` | Show the account's transaction history: incoming and outgoing transfers from the network, plus what this CLI sent | `--direction in\|out\|all`, `--from <fast1...>`, `--limit <n>`, `--local` (only what this CLI sent, no explorer lookup), `--json` |
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
| `fast fund usdc fiat` | Print a Ramp on-ramp URL for funding with USDC (mainnet only). | `--network mainnet`, `--address` |
| `fast fund usdc crypto <amount>` | Bridge USDC from an EVM chain into the Fast account. Defaults `--token` to `network.defaultToken.symbol` when omitted. On mainnet that's `fastUSD`, which is not on EVM chains by default — pass `--token USDC` for the bridge case. The command errors with `CommandUnsupportedForTokenError` otherwise. | `--chain <chain>` (required), `--token`, `--eip-7702` (gasless) |
| `fast fund fastusd` | Print an `app.fast.xyz/send` URL that opens the unified Fast funding page (mainnet only). Funds **fastUSD** (Fast-native, distinct from bridged USDC). | `--to <fast1...>`, `--amount <decimal>` |

### `send` command

```sh
fast send <address> <amount> [--token <TOKEN>] [--from-chain <chain>] [--to-chain <chain>] [--eip-7702]
```

| Argument / Flag | Description | Allowed values |
|---|---|---|
| `<address>` | Recipient | `fast1...` (Fast network), `0x...` (EVM), or a Fast ID name like `alice.smith` (resolved to its `fast1...` address on the current network) |
| `<amount>` | Amount to send | numeric string, e.g. `"20"` |
| `--token <TOKEN>` | Defaults to `network.defaultToken.symbol` (`fastUSD` on mainnet, `testUSDC` on testnet) when omitted. Bridge routes (`--from-chain` / `--to-chain`) require the resolved token to be available on the target chain; otherwise the command errors with `CommandUnsupportedForTokenError`. | `USDC`, `fastUSD`, `testUSDC` |
| `--from-chain <chain>` | Bridge from this EVM chain into Fast | e.g. `arbitrum-sepolia`, `base` |
| `--to-chain <chain>` | Bridge from Fast to this EVM chain | e.g. `arbitrum-sepolia` |
| `--eip-7702` | Gasless deposit (no ETH needed on EVM side) | flag, no value |

> **Always pass `--token USDC` explicitly** when bridging or sending USDC — do not rely on the default.

### `request` command

```sh
fast request <amount> [--to <fast1...|name>] [--qr] [--qr-file <path.svg>] [--wait [--timeout <seconds>]] --network mainnet
```

| Argument / Flag | Description |
|---|---|
| `<amount>` | fastUSD amount to ask for, positive decimal with at most 6 decimal places |
| `--to <fast1...\|name>` | Who is to be paid; defaults to the active account. A `fast1...` address or a Fast ID name (`alice.smith`), resolved first; the link keeps the name and `--json` adds `toName` |
| `--qr` | Also print a terminal QR code (goes to stderr with `--json`) |
| `--qr-file <path.svg>` | Write an SVG QR code; its absolute path is returned as `qrFile` |
| `--wait` | After printing the link, block until exactly this amount arrives from someone else; adds `payment` to the JSON |
| `--timeout <seconds>` | With `--wait`: give up after this long (default 300) with `PAYMENT_TIMEOUT` |

Mainnet only. It only builds a link (`https://app.fast.xyz/send?to=…&amount=…`); nothing is signed or sent. A Fast ID `--to` is looked up on the registry first (network call); with `--wait` it then watches for the payment. See workflow 9.

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

### `wait-for-payment` command

```sh
fast wait-for-payment --amount <AMOUNT> [--token <TOKEN>] [--from <fast1...>] [--to <fast1...>] [--since <ISO time>] [--timeout <seconds>]
```

Blocks until an incoming payment of **exactly** `<AMOUNT>` (default token: the network's) reaches the active account (or `--to`), then prints it. Exits 1 with `PAYMENT_TIMEOUT` if nothing matching arrives within `--timeout` (default 300 s).

---

## Use Cases

**Use when:**

- Create or manage Fast accounts from the terminal
- Check token balances on Fast or EVM chains
- Send USDC between Fast addresses or bridge to/from EVM
- Get paid: create a payment-request link for someone to pay the user
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

When running `fast fund usdc crypto` or `fast send --from-chain <chain>`, the CLI
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

### Check incoming payments ("did Leo pay me?", "what came in today?")

```sh
# Everything received recently (other accounts' payments and EVM → Fast deposits)
fast info history --direction in --json

# Only payments from one sender
fast info history --direction in --from fast1leo... --json

# Block until a specific payment arrives (exact amount; default token unless --token)
fast wait-for-payment --amount 25 --from fast1leo... --json
fast wait-for-payment --amount 25 --since 2026-10-02T12:00:00Z --timeout 600 --json
```

- `info history` rows have `direction` (`in`/`out`/`self`) and `source` (`network` = read from the Fast explorer, `local` = sent by this CLI). For "what came in today?", keep rows with `direction: "in"` and a `timestamp` from today (UTC), and raise `--limit` if the page is full.
- If `data.warnings` is non-empty, network history is **missing or incomplete**: either it was not read at all (explorer unreachable or not configured) or paging stopped before enough rows matched the filters. Say so, and do not conclude that nothing arrived.
- `wait-for-payment` only matches the exact amount and token, sent at or after `--since` (default: when the command starts). If the payer may already have paid, pass `--since` with a time before they paid. On success, `data.hash` and `data.explorerUrl` identify the payment.
- `PAYMENT_TIMEOUT` means no matching payment was seen in time (the message says if the explorer was failing). Report that; don't retry forever.
- **Never tell the user a payment arrived unless `fast info history` or `fast wait-for-payment` shows it.** A sender's message, a balance you assume changed, or a link you were sent is not confirmation.

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

### 3. Send tokens on Fast (Fast → Fast)

```sh
# Default token: fastUSD on mainnet, testUSDC on testnet.
fast send fast1ab2...y3w 10.5

# To send USDC explicitly, pass --token:
fast send fast1ab2...y3w 10.5 --token USDC
```

### Send to a Fast ID name

```sh
fast send alice.smith 10 --json
# → data.to is the resolved fast1... address, data.toName is "alice.smith"
```

- Names are two lowercase labels (`alice.smith`). A bare first name (`alice`) is not a Fast ID; ask the user for the full name or a `fast1...` address.
- Sends are irreversible. Before the first send to a new recipient, tell the user the name **and** the resolved `fast1...` address and get a yes.
- `INVALID_ADDRESS` with "not registered" means the name doesn't exist on this network; `FAST_ID_RESOLUTION_FAILED` means the registry couldn't be read. In both cases nothing was sent; don't guess an address.
- Names can't be used with `--to-chain` (bridge-out needs a `0x...` address).

### 4. Fund from EVM → Fast (`fast fund usdc crypto`)

```sh
fast fund usdc crypto 50 --chain arbitrum-sepolia
```

**What happens:**

1. Checks ERC-20 balance on `arbitrum-sepolia` for the account's EVM address.
2. If sufficient: executes bridge deposit automatically.
3. If insufficient: prints the EVM address and shortfall, exits with code 4
   (`FUNDING_REQUIRED`). Send tokens to that address first, then re-run.

> Find your EVM address with `fast account list`.

#### Gasless variant with EIP-7702 (no ETH needed)

```sh
fast fund usdc crypto 50 --chain base --eip-7702
```

Gas is paid in USDC instead of ETH. Approve + deposit are batched into a single
UserOperation via the AllSet Portal and Pimlico.

### 5. Bridge USDC from Fast → EVM

```sh
fast send 0xYourEvmAddress 25 --token USDC --to-chain arbitrum-sepolia
```

### 6. Fund via fiat (mainnet only)

```sh
fast fund usdc fiat --network mainnet
# → prints a Ramp on-ramp URL for funding with USDC
```

### 7. Fund fastUSD via the unified Fast web app

```sh
fast fund fastusd --network mainnet
# → prints app.fast.xyz/send?to=<your-fast-address>
fast fund fastusd --network mainnet --amount 25
# → adds &amount=25
```

This URL is mainnet-only and funds **fastUSD** (a Fast-native token, separate
from bridged USDC).

### 8. Pay an x402-protected URL

```sh
fast pay https://api.example.com/resource

# POST with a body:
fast pay https://api.example.com/resource --method POST --body @request.json

# Inspect without paying:
fast pay https://api.example.com/resource --dry-run
```

### 9. Get paid: request a payment

Use this when the user wants to be paid ("Leo owes me $10, ask him"):

```sh
fast request 10 --network mainnet --json
# → data.url: https://app.fast.xyz/send?to=<your-fast-address>&amount=10
# → data.createdAt: when the request was made
# Optional: also write a QR code image to share
fast request 10 --network mainnet --qr-file request.svg --json
# → data.qrFile: absolute path of the SVG
```

1. Show the user `data.url` (and the QR image if you made one) and tell them to send it to the payer. Opening it shows the Fast app's Send screen with the amount and the user's address filled in; the payer confirms there.
2. The payment goes to the active account unless you pass `--to <fast1...>` or `--to <name>` (a Fast ID such as `alice.smith`; an unregistered name fails with `INVALID_ADDRESS` and no link). Amounts are fastUSD on mainnet; the link carries no memo.
3. **Never say the payment arrived because the link was created or shared.** Creating a request moves no money. Confirm it on the network first:
   ```sh
   fast wait-for-payment --amount 10 --since <data.createdAt> --network mainnet --json
   # or, to print the link and wait in one step:
   fast request 10 --network mainnet --wait --timeout 600 --json   # → data.payment
   ```
   Only report it as paid when one of these returns the payment (`data.hash`, `data.from`, `data.explorerUrl`). On `PAYMENT_TIMEOUT`, tell the user nothing matching has arrived yet; the link stays valid and you can wait again with the same `--since`.
4. `INVALID_USAGE` mentioning `--network mainnet` means the command ran on another network; re-run with `--network mainnet`.

---

## Common Pitfalls

### Fast address vs. EVM address — same key, different format

The `fast1...` and `0x...` addresses shown by `fast account list` are both
derived from the **same private key**. You do not need a separate EVM wallet.
When depositing via a bridge UI or another wallet, use the EVM address from
`fast account list`.

### `fast fund usdc crypto` vs. `fast send --from-chain`

| Command | Use when |
|---|---|
| `fast fund usdc crypto <amount> --chain <chain>` | Top up your own Fast account from your own EVM balance |
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
