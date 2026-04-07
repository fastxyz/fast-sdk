# Fund & Pay Commands Design

## Goal

Add `fast fund` (fiat + crypto sub-commands) and
`fast pay` (x402 protocol) to the CLI, completing the
last major feature set from the SPEC.

## Architecture

`fast fund` is purely informational — it prints funding
URLs or addresses with no transactions. `fast pay` wraps
`@fastxyz/x402-client` via a thin `X402Service`, following
the same pattern as `AllSet` and `FastRpc`.

## Commands

### `fast fund fiat`

**Synopsis:**
`fast fund fiat [--address <fast-address>]`

Generates a fiat on-ramp URL and prints it.

**Flow:**

1. Resolve Fast address from `--address` or default account
2. Construct URL:
   `https://allramp.fast.xyz/?fastAddress=<address>`
3. Print URL interactively, ask user to open in browser
4. JSON output: `{ url, address, tokenName }`

No password prompt — read-only, uses public addresses.

**Parser:** Sub-command under `fund` group with optional
`--address` string flag.

### `fast fund crypto`

**Synopsis:** `fast fund crypto`

Prints the user's EVM address so they can send tokens
from an exchange or external wallet.

**Flow:**

1. Resolve account (from `--account` global or default)
2. Print the account's EVM address and Fast address
3. JSON output: `{ evmAddress, fastAddress, accountName }`

No password prompt — read-only, uses public addresses.

**Parser:** Sub-command under `fund` group, no extra flags.

### `fast pay`

**Synopsis:**
`fast pay <url> [--dry-run] [--method <method>]`
`[--header <key: value>]... [--body <data | @file>]`

Accesses x402 payment-protected resources.

**Flow (normal mode):**

1. Parse args — URL, method, headers, body
2. Resolve `--body @file` if applicable (read file)
3. Resolve account, prompt for password
4. Decrypt seed, build `FastWallet` + `EvmWallet`
5. Call `X402Service.pay()` (delegates to `x402Pay()`)
6. Print response body + payment summary
7. Record payment in history store (type: "payment")
8. JSON output: `{ txHash, amount, formatted,`
   `tokenName, recipient, paymentType,`
   `network, response }`

**Flow (--dry-run mode):**

1. Make the initial HTTP request to the URL
2. If 402, parse and display payment requirements
   (amount, recipient, network, accepted options)
3. Do NOT execute payment — no password needed
4. JSON output: `{ statusCode, paymentRequired,`
   `acceptedOptions }`
5. Exit 0

**Parser:**

- `<url>` — positional argument (required)
- `--dry-run` — boolean flag
- `--method` — string, default `GET`
- `--header` — repeatable string, `key: value`
- `--body` — optional string; `@` prefix reads file

**`@file` body convention:** Follows curl's pattern. If
`--body` starts with `@`, the remainder is a file path.
Avoids shell escaping issues with inline JSON. Agents
can write payloads to temp files and pass the path.

## X402Service

Thin Effect wrapper around `@fastxyz/x402-client`,
following the `AllSet` service pattern.

**Location:** `services/api/x402.ts`

**Methods (inferred via `Effect.Service`):**

- `pay(params)` — wraps `x402Pay()`, maps errors to
  `PaymentRejectedError` / `PaymentFailedError`
- `dryRun(params)` — makes initial HTTP request, parses
  402 headers, returns requirements without paying

**Dependencies:** None — pure SDK wrapper. Wallet
construction happens in the command handler.

**Wiring:** Added to `tier1` in `app.ts`.

## Error Types

New file: `errors/payment.ts`

| Error Class | exit | errorCode |
| --- | --- | --- |
| `PaymentRejectedError` | 6 | `PAYMENT_REJECTED` |
| `PaymentFailedError` | 1 | `PAYMENT_FAILED` |
| `InvalidPaymentLinkError` | 2 | `INVALID_PAYMENT_LINK` |
| `InsufficientPaymentBalanceError` | 4 | `INSUFFICIENT_PAYMENT_BALANCE` |

Triggers:

- **PaymentRejectedError** — server rejected payment proof
- **PaymentFailedError** — `x402Pay` threw unexpectedly
- **InvalidPaymentLinkError** — URL invalid or no 402
- **InsufficientPaymentBalanceError** — not enough balance

All added to `ClientError` union in `errors/index.ts`.

## File Structure

| File | Action |
| --- | --- |
| `commands/fund/fiat.ts` | Create |
| `commands/fund/crypto.ts` | Create |
| `commands/pay.ts` | Create |
| `services/api/x402.ts` | Create |
| `errors/payment.ts` | Create |
| `errors/index.ts` | Modify |
| `cli.ts` | Modify |
| `commands/index.ts` | Modify |
| `app.ts` | Modify |

## Decisions

- **No auto-bridge in `fund crypto`**: `send` already
  handles bridging. `fund crypto` just prints the EVM
  address for manual funding.
- **x402-client SDK used directly**: No manual 402 flow.
  The SDK handles request, detection, payment, and retry.
- **Dedicated payment errors**: Pay is a distinct domain
  with different exit codes (6 for rejected vs 2 for
  transaction failures).
- **`@file` body support**: Trivial, matches curl, useful
  for agent workflows.
- **No password for fund or dry-run**: Both are read-only.
