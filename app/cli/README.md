# fast CLI

A command-line tool for the [Fast network](https://fast.xyz) — manage accounts, send tokens, bridge assets between EVM chains and Fast, add fastUSD through supported funding routes, and pay x402-protected APIs.

## Installation

**Requires Node.js 20+**

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

# Attach a Fast UserData memo (32 UTF-8 bytes maximum)
fast send fast1abc...xyz 10 --token USDC --memo "invoice-42"

# Ask someone to pay you 10 fastUSD: prints an app.fast.xyz link to share (mainnet only)
fast request 10 --network mainnet

# Bridge USDC from Arbitrum Sepolia to Fast (--token USDC is required on
# mainnet because the network default — fastUSD — is not on EVM chains)
fast fund usdc crypto 50 --chain arbitrum-sepolia --token USDC

# Choose one of the four supported Fast app funding routes (mainnet only)
fast fund --network mainnet --amount 50

# Or choose a specific route directly
fast fund card --network mainnet --amount 50
fast fund usdc --network mainnet
fast fund crypto --supplier coinbase --network mainnet

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

### `fast multisig`

Create or import a Rust-compatible multisig wallet, inspect its current-nonce
pending transactions, and co-sign them:

```bash
fast multisig init --name treasury --signers alice,bob,fast1... --quorum 2 --config-nonce 0
fast multisig import --from ./wallet.json --name treasury
fast multisig pending --account treasury --as alice
fast multisig vote --account treasury --as alice --tx 0x...
```

Signer order is canonicalized by decoded 32-byte address (not bech32 text).
`vote` prints the complete transaction before an interactive signature. Export
uses exclusive file creation and never overwrites an existing file.

Initiating `send` or `token` operations performs a best-effort preflight and
refuses when it observes another multisig proposal at the current nonce.
Inspect it with `fast multisig pending`; only pass `--replace-pending` when
replacing that observed proposal is intentional. This check is not atomic with
submission: concurrent initiators can both observe an empty pending set, and
the proxy may then replace the first proposal. A voter that fetched proposal A
before an explicit replacement with B can likewise submit its stale vote and
restore A. Strict no-replacement semantics require operator-wide serialization
across initiation, replacement, and voting; after replacement, all stale voting
sessions must be abandoned. A future conditional-submit primitive in the proxy
is required to enforce this invariant server-side.

If the proxy accepts a signed envelope but its response is lost, the CLI emits
`TX_SUBMISSION_UNKNOWN` with the precomputed transaction hash, nonce, and exact
signed REST envelope. Do not rerun the original command: first reconcile that
identity against the explorer, account nonce, and pending multisig proposals.
Where resubmission is appropriate, resubmit the preserved envelope rather than
building a new transaction with a new timestamp or nonce.

---

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
fast account import --name my-signer --legacy-keystore /path/to/legacy-keystore.json
```

**Options:**

- `--name <alias>` — Optional human-readable alias for the imported account
- `--private-key <hex>` — Hex-encoded 32-byte private key
- `--key-file <path>` — Path to a JSON file containing a `privateKey` field
- `--legacy-keystore <path>` — Encrypted JSON keystore from the original Rust multisig CLI

If `--name` is omitted, the CLI auto-generates one. Provide exactly one key source. The legacy option prompts for its password, verifies the file's Fast address, and stores the imported key encrypted. The original file is not changed.

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

# Send to a Fast ID name; the CLI resolves it to the bound fast1... address first
fast --network mainnet send alice.smith 10

# Withdraw USDC from Fast mainnet to Polygon mainnet
fast --network mainnet send 0x1234567890123456789012345678901234567890 0.01 --to-chain polygon --token USDC
```

**Positional arguments:**

- `<address>` — Recipient: a `fast1...` address (Fast), a `0x...` address (EVM), or a [Fast ID](https://id.fast.xyz) name such as `alice.smith`. Names are resolved on the current network (mainnet or testnet) before anything is signed; the confirmation shows `alice.smith (fast1...)`, and `--json` output adds `toName`. Resolution fails closed: an unregistered name exits with `INVALID_ADDRESS`, and an unreachable or inconsistent registry exits with `FAST_ID_RESOLUTION_FAILED`, in both cases without sending. Names can't be used with `--to-chain`, which needs a `0x...` recipient.
- `<amount>` — Human-readable amount (for example, `10` or `1.5`)

**Options:**

- `--from-chain <chain>` — Source EVM chain for EVM → Fast transfers
- `--to-chain <chain>` — Destination EVM chain for Fast → EVM transfers
- `--token <token>` — Token symbol or token ID. Defaults to the network's `defaultToken.symbol` (`fastUSD` on mainnet, `testUSDC` on testnet). Bridge routes require the resolved token to be available on the target chain; otherwise the command errors with `CommandUnsupportedForTokenError`.
- `--eip-7702` — Use the smart deposit flow for EVM → Fast transfers
- `--account <name>` — Sender account (defaults to the configured default)

---

### `fast request <amount>`

Create a payment-request link: a URL that opens the Fast app's Send screen
with the recipient and amount filled in. Share it with whoever should pay you;
they review and confirm the transfer in the app. Nothing is signed or sent by
this command, and no password is needed. It works offline unless `--to` is a
Fast ID name (resolved on the Fast ID registry first) or `--wait` is set
(watches the explorer for the payment).

```bash
fast request 10 --network mainnet
# → https://app.fast.xyz/send?to=fast1...&amount=10

# Machine-readable, with a QR code image to share
fast request 10 --network mainnet --qr-file request.svg --json

# Ask for payment to another address you control, or to a Fast ID name
fast request 2.50 --network mainnet --to fast1someoneelse...
fast request 2.50 --network mainnet --to alice.smith

# Print the link, then block until the payment arrives (default timeout 300 s)
fast request 10 --network mainnet --wait --json
```

**Positional arguments:**

- `<amount>` — Amount of fastUSD to request: a positive decimal with at most 6 decimal places (`10`, `2.50`, `.5`). It is normalized (`010.50` → `10.5`) before going into the link.

**Options:**

- `--to <fast1...|name>` — Who is to be paid (default: the active account; with a multisig wallet, the wallet address): a valid `fast1...` address or a [Fast ID](https://id.fast.xyz) name such as `alice.smith`. A name is resolved on mainnet first and fails closed like in `fast send` (`INVALID_ADDRESS` if unregistered, `FAST_ID_RESOLUTION_FAILED` if the registry can't be read). The link then carries the name (`?to=alice.smith`), so the payer sees it and the app resolves it again at payment time; `--json` returns the resolved `address` plus `toName`.
- `--qr` — Also print the link as a QR code in the terminal. With `--json`, the QR code goes to stderr so stdout stays a single JSON document.
- `--qr-file <path.svg>` — Write the link as an SVG QR code to this path (overwritten if it exists).
- `--wait` — After printing the link, wait until the payee receives exactly this amount of fastUSD from another address, sent after the request was created (same matching as `fast wait-for-payment`). Fails with `PAYMENT_TIMEOUT` (exit 1) if nothing arrives in time; the error message repeats the link and when the request was created (`created <createdAt>`), the `--since` for waiting again with `fast wait-for-payment`.
- `--timeout <seconds>` — With `--wait`, how long to wait (default: 300, at most 2147483, about 24 days). Rejected without `--wait`.

**Output (`--json`):**

```json
{
  "ok": true,
  "data": {
    "url": "https://app.fast.xyz/send?to=fast1...&amount=10",
    "address": "fast1...",
    "amount": "10",
    "token": "fastUSD",
    "network": "mainnet",
    "createdAt": "2026-10-02T12:00:00.000Z",
    "qrFile": "/abs/path/request.svg"
  }
}
```

`qrFile` is present only with `--qr-file`. `createdAt` is when the request was made;
pass it as `--since` to `fast wait-for-payment` to wait for this request later.
With `--wait`, `data` also has a `payment` object with the matching transfer
(`hash`, `type`, `from`, `to`, `amount` in base units, `formatted`, `tokenName`,
`tokenId`, `timestamp`, `explorerUrl`).

**Requirements:**

- Mainnet only (the Fast app runs on mainnet); other networks exit with `INVALID_USAGE`.
- The link does not prove anything was paid. Confirm the payment with `--wait`, `fast wait-for-payment --since <createdAt>`, or `fast info history --direction in`.

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

Show the selected account's transaction history (`--account`, else the default account): transfers read from the network's explorer API, including payments received from other accounts and EVM → Fast deposits, merged with the transactions this CLI recorded locally. Newest first.

```bash
fast info history --limit 20

# Only incoming payments, e.g. "did Leo pay me?"
fast info history --direction in --from fast1leo... --json

# Only what this CLI recorded locally, for every local account (no explorer lookup)
fast info history --local
```

**Options:**

- `--direction <in|out|all>` — Only incoming (`in`), only outgoing (`out`), or everything (`all`, default). Self transfers only appear with `all`.
- `--local` — Previous behaviour: list only the local log (what this CLI submitted), for every local account, without calling the explorer API. Add `--account <name>` to narrow it to one account. Received payments do not appear. As before, pending bridge entries are still re-checked against the AllSet portal, so the command is not fully offline.
- `--from <address>` — Filter by sender address
- `--to <address>` — Filter by recipient address
- `--token <token>` — Filter by token name or token ID (a symbol also matches its token ID on the current network)
- `--limit <n>` — Max number of records to return
- `--offset <n>` — Number of records to skip

Each row has the same fields as before plus `direction` (`in`, `out` or `self`, relative to the account) and `source` (`network` or `local`). A network transfer that this CLI also recorded locally (same Fast transaction hash) is shown once, as the local entry. `--json` output also includes `account` and a `warnings` array. If the explorer API is unreachable, or the network has no `explorerApiUrl`, the command still succeeds with local history only and reports why in `warnings` (and on stderr). A warning also appears if paging stopped before enough network rows matched the filters. Whenever `warnings` is non-empty, missing incoming payments do not mean nothing arrived. With no account at all, it lists the whole local log as before.

---

### `fast wait-for-payment`

Block until a matching incoming payment arrives, then print it. It polls the network's explorer API every 2 seconds and matches an incoming Fast transfer or EVM → Fast deposit (`Mint`) to the watched address with exactly the given amount and token, sent at or after `--since`.

```bash
# Wait up to 5 minutes for exactly 25 fastUSD from a specific sender
fast --network mainnet wait-for-payment --amount 25 --from fast1leo... --json

# Watch another address for 0.5 testUSDC sent since 12:00 UTC, for 10 minutes
fast wait-for-payment --amount 0.5 --to fast1... --since 2026-10-02T12:00:00Z --timeout 600
```

**Options:**

- `--amount <amount>` — Exact amount expected, human-readable (required). Converted with the token's decimals; the payment must match to the base unit.
- `--token <token>` — Token symbol or token ID. Defaults to the network's `defaultToken.symbol`.
- `--from <fast1...>` — Only accept a payment from this sender
- `--to <fast1...>` — Address to watch (default: the active account)
- `--since <iso-time>` — Only accept payments submitted at or after this time (default: when the command starts). Times without a zone are read as UTC.
- `--timeout <seconds>` — Give up after this many seconds (default: 300, at most 2147483, about 24 days)

`--json` returns `{ ok: true, data: { hash, type, from, to, amount, formatted, tokenName, tokenId, timestamp, explorerUrl, network } }`. If nothing matching arrives in time, it exits 1 with `PAYMENT_TIMEOUT`; explorer errors while polling are retried until then, and the timeout message says if the last poll failed. Networks without an explorer API fail with `EXPLORER_NOT_CONFIGURED`.

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

### `fast fund` app funding routes

`fast fund` interactively selects one of the four supported funding routes. All
four routes credit the Fast account as **fastUSD**; USDC is an external source
asset, not a separate native USDC balance on Fast.

```bash
# Interactive selector
fast fund --network mainnet

# Direct routes
fast fund card --network mainnet [--address fast1...] [--amount 25]
fast fund usdc --network mainnet [--address fast1...]
fast fund crypto --supplier coinbase --network mainnet [--address fast1...] [--amount 25]
fast fund crypto --supplier swapper --network mainnet [--address fast1...] [--amount 25]
```

The URLs use only the currently supported app routes:

| Method | App URL |
|---|---|
| Card | `https://app.fast.xyz/card?to=<fast-address>` |
| USDC from another network | `https://app.fast.xyz/usdc?to=<fast-address>` |
| Coinbase | `https://app.fast.xyz/crypto?supplier=coinbase&to=<fast-address>` |
| Swapper | `https://app.fast.xyz/crypto?supplier=swapper&to=<fast-address>` |

Hosted links are mainnet-only. `--address` defaults to the active account;
`--amount` optionally prefills the route when supported. In `--json` or
`--non-interactive` mode, choose a method explicitly instead of invoking the
interactive selector.

`fast fund usdc fiat` remains as a deprecated alias for `fast fund card`.
`fast fund fastusd` remains as a deprecated alias for the interactive selector.

---

### `fast fund usdc crypto <amount>` — EVM bridge

Bridge USDC from an EVM chain to the Fast network. USDC is the external source
asset; the Fast-side asset is selected by the configured route (for example,
fastUSD on mainnet and testUSDC on testnet).

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

### Legacy `fast fund fastusd`

This deprecated alias now opens the interactive funding-method selector. Prefer
`fast fund` for the selector or an explicit route such as `fast fund card`.
In JSON or non-interactive mode, specify a route directly.

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

Add `"explorerApiUrl"` (the explorer indexer API base, e.g. `https://testnet.api.fast.xyz`) to enable network history and `fast wait-for-payment` on a custom network; without it, `fast info history` shows local history only.

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

# 2. Choose a hosted funding method; all routes credit fastUSD
fast fund --network mainnet --address fast1...

# 2b. Or select the Card route directly
fast fund card --network mainnet --address fast1...

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
