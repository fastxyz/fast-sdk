---
name: fast
description: >
  fast CLI for managing Fast network accounts, sending tokens, funding via bridge or fiat,
  and paying x402-protected APIs. Use when the user wants to run fast commands, create accounts,
  check balances, send USDC, or interact with the Fast network from the terminal.
---

# fast CLI

## Agent Bootstrap

**Run these steps before executing any `fast` command.**

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

Custom networks can be added from a JSON config file via `fast network add`.

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
```

### 2. Check balances

```sh
fast info balance
fast info balance --json   # machine-readable
```

`fast info balance` shows balances on Fast **and** on each bridgeable EVM chain.

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
fast send 0xYourEvmAddress 25 --to-chain arbitrum-sepolia
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
| EVM → Fast (standard) | `fast send <fast1-address> <amount> --from-chain <chain>` |
| EVM → Fast (gasless, no ETH) | `fast send <fast1-address> <amount> --from-chain <chain> --eip-7702` |
| Fast → EVM | `fast send <0x-address> <amount> --to-chain <chain>` |
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