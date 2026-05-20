<!-- markdownlint-disable MD013 -->
# CLI `fund` restructure and fastUSD adoption — Design

## Goal

Two coordinated changes in `app/cli`, plus light cosmetic fixes in
`packages/x402-client`:

1. **`fund` command restructure.** Re-shape the `fund` subcommand
   group to reflect the *target token* of each funding path, and
   add a new path for funding `fastUSD` (a Fast-native token) via
   the unified `app.fast.xyz/send` web app.
2. **`fastUSD` adoption.** Make `fastUSD` the default token for
   `fast send` Fast→Fast on **mainnet**, register `fastUSD` in the
   bundled network config, and stop mislabeling x402 payments as
   `USDC` in display/log/history when the actual asset paid was
   different.

The work goes on a fresh branch off `main`. The `feat/multisig-cli`
branch (PR #85) is untouched.

## Background

### Today's `fund` group

`fast fund` has two subcommands:

| Command                                  | Behavior                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `fast fund fiat`                         | Prints `https://ramp.fast.xyz/?to=<addr>` (Ramp → fastUSDC). Mainnet only.|
| `fast fund crypto <amount> --chain <c>`  | Executes an EVM→Fast bridge via `@fastxyz/allset-sdk` → fastUSDC on Fast. |

Both paths land on **fastUSDC** — the EVM-bridged Fast representation
of USDC.

### `fastUSD` vs `fastUSDC`

`fastUSD` is a separate Fast-native token (mint-only, no EVM
counterpart). `fastUSDC` is the EVM-bridged variant. They are not
the same token and `fastUSDC` is **not** being deprecated.

The unified Fast web app at `app.fast.xyz/send` lets a user fund a
Fast wallet with `fastUSD` via fiat-on-ramp, crypto-bridge, or
wallet-to-wallet, all in one place. The CLI should be able to emit
the URL that opens that page for a given recipient and amount —
nothing more. The CLI does not execute the funding itself.

### x402 token reality

`fast pay` is the CLI front-end for the x402 HTTP-payment protocol
(`@fastxyz/x402-client`). The client does **not** choose the token
to pay with — the server returns a `paymentRequired.accepts[]`
array, each entry naming a `network`, `payTo`, `maxAmountRequired`,
and `asset` (token ID). The client picks one of the accepted
entries and pays in whatever asset that entry specifies.

Despite this, three places in the CLI / x402-client hardcode the
string `"USDC"` regardless of the actual asset paid. They are
display-only, but they lie:

- [pay.ts:94](app/cli/src/commands/pay.ts#L94) — dry-run printer:
  `Asset: ${opt.asset ?? "USDC"}`.
- [pay.ts:191](app/cli/src/commands/pay.ts#L191) — history entry:
  `tokenName: "USDC"` hardcoded.
- [fast.ts:137](packages/x402-client/src/fast.ts#L137) — verbose
  log: `→ ${amountHuman} USDC`.

Once `fastUSD` lands as a registered token, these strings will
mislabel any `fastUSD` payment as `USDC`.

### Bundled network config

`app/cli/src/config/networks.json` defines two networks (`testnet`,
`mainnet`). Each network has an `allset` block with per-EVM-chain
token registries. Today every chain registers a single entry —
`testUSDC` on testnet, `USDC` on mainnet — keyed to its EVM
address and a network-wide Fast token ID.

There is no concept of a Fast-native token in the schema because
every existing token has an EVM counterpart. `fastUSD` is the
first exception.

## Scope

### In scope

- Re-shape `fund` subcommand tree to two-deep: `fund usdc fiat`,
  `fund usdc crypto`, plus new `fund fastusd`.
- New `fund fastusd` URL-emitter command (mainnet-only).
- New mainnet `fastTokens.fastUSD` entry in `networks.json`.
- `send` Fast→Fast default token resolution: prefer mainnet
  `fastUSD` when no `--token` is supplied.
- Extend `resolveToken` to consult `fastTokens` when no chain
  context is given.
- Replace the three cosmetic `"USDC"` mislabels with the actual
  asset name (resolved against the network's token registry).
- Doc sync: `skills/fast/SKILL.md`, `app/cli/README.md`, and any
  stale references in root `README.md` / `SPEC.md`.

### Out of scope

- `feat/multisig-cli` branch (PR #85). Untouched.
- `@fastxyz/allset-sdk` removal — kept; `send` bridging routes and
  `fund usdc crypto` still depend on it.
- `x402-types`, `x402-facilitator`, `x402-server` packages — not
  modified. Their `usdcAddress` / `usdcName` / `usdcVersion`
  fields are EVM-side EIP-3009 settlement concerns; `fastUSD`
  has no EVM counterpart and so cannot be settled there.
- `parsePrice` regex stripping `/usdc/i` from price strings — left
  alone; price-string parsing is not on a `fastUSD` path yet.
- `bridgeFastusdcToUsdc` rename in `x402-client` — cosmetic only,
  defer to a separate cleanup if ever needed.
- testnet `fastUSD` — does not exist; testnet behavior is unchanged
  (testnet `send` Fast→Fast default stays `testUSDC`; `fund
  fastusd` errors on testnet).
- Any QR-code rendering or browser-launch (`--open`) features for
  the new URL command — modern terminals make URLs ctrl-clickable;
  YAGNI.
- Removing or renaming `fund fiat` / `fund crypto` without a
  replacement — both behaviors are preserved, just under new
  command paths (`fund usdc fiat` / `fund usdc crypto`).

## Architecture

```text
app/cli
  src/
    cli.ts                     (modified: new arg types, new optique parsers)
    main.ts                    (modified: 2-deep dispatch for `fund usdc *`)
    commands/
      index.ts                 (modified: swap fund-fiat/fund-crypto for fund-usdc-fiat/fund-usdc-crypto/fund-fastusd)
      fund/
        usdc/
          fiat.ts              (RENAMED from fund/fiat.ts; logic unchanged)
          crypto.ts            (RENAMED from fund/crypto.ts; logic unchanged)
        fastusd.ts             (NEW)
      pay.ts                   (modified: B2-fix display/history truth)
      send.ts                  (modified: B1 — mainnet default = fastUSD)
    config/
      networks.json            (modified: mainnet gains fastTokens.fastUSD)
    schemas/
      networks.ts              (modified: BundledNetworksSchema gains optional fastTokens)
    services/
      token-resolver.ts        (modified: consult fastTokens for no-chain lookups)

packages/x402-client
  src/
    fast.ts                    (modified: log line shows actual asset, not "USDC")

skills/fast/SKILL.md           (modified)
app/cli/README.md              (modified)
README.md, SPEC.md             (scanned; updated only if stale references found)
```

`@fastxyz/sdk`, `@fastxyz/schema`, `@fastxyz/allset-sdk`,
`@fastxyz/x402-types`, `@fastxyz/x402-facilitator`,
`@fastxyz/x402-server` are unchanged.

### Data flow: `fast fund fastusd`

1. CLI parses `fund fastusd` (no positional args).
2. Active network must be `mainnet`. If not, fail with
   `InvalidUsageError` mirroring `fund usdc fiat`'s testnet check.
3. Resolve `--to`: if `args.to` is set, validate it starts with
   `fast1`; else look up the active account and use its
   `fastAddress`.
4. Build the URL:
   - Base: `https://app.fast.xyz/send`
   - Append `?to=<addr>` always (since `to` always resolves to a
     value).
   - Append `&amount=<n>` only if `--amount` was supplied. The
     web app tolerates omission.
5. Print the URL with the same human-line wrapper that `fund usdc
   fiat` uses today (`Open this URL in your browser to fund your
   account: <url>`).
6. `output.ok({ url, address })` for JSON mode.

No transaction. No history record. No allset, no x402, no signer.

### Data flow: `fast send <recipient> <amount>` (Fast→Fast, mainnet, no `--token`)

1. CLI loads active account, resolves the recipient as a `fast1*`
   address.
2. `resolveToken(undefined, network, undefined)` is called (no
   `--token`, no `--from-chain` / `--to-chain` so no chain context).
3. **New behavior:** `resolveToken` first checks
   `network.fastTokens` for a default token. On mainnet,
   `fastTokens.fastUSD` is present → return its `fastTokenId` and
   `decimals`. On testnet, `fastTokens` is absent → fall through
   to the existing per-chain scan, which finds `testUSDC` (current
   behavior preserved).
4. `--token <name>` overrides this default unconditionally — name
   is looked up first in `fastTokens`, then in chain-scoped
   tokens, matching today's resolver semantics.
5. Rest of `send` Fast→Fast is unchanged.

For EVM bridging routes (`--from-chain` / `--to-chain`),
`resolveToken` is called with chain context and only consults
`allset.chains[chain].tokens` — `fastTokens` is not consulted
because EVM bridging needs an EVM-side token. Behavior unchanged.

### Data flow: x402 display/history truth (B2-fix)

1. **Dry-run display.** [pay.ts:94](app/cli/src/commands/pay.ts#L94)
   currently prints `Asset: ${opt.asset ?? "USDC"}`. New behavior:
   resolve `opt.asset` (a token-ID hex string) against the network's
   token registry. If the registry has an entry whose `fastTokenId`
   matches, print that entry's display name; else print the short
   hex (`opt.asset`). Never print `"USDC"` for a non-USDC asset.
2. **History `tokenName`.**
   [pay.ts:191](app/cli/src/commands/pay.ts#L191) currently writes
   `tokenName: "USDC"` regardless of what was paid. New behavior:
   `result.payment` already includes the network and amount; add
   `asset` to the `X402PayResult.payment` shape (in
   `x402-client/types.ts`) so the CLI can map it to a registry
   entry and write the correct `tokenName`. Fall back to
   `"unknown"` if the asset is not registered.
3. **Verbose log line.**
   [fast.ts:137](packages/x402-client/src/fast.ts#L137) currently
   logs `→ ${amountHuman} USDC`. Change to `→ ${amountHuman}
   (asset ${fastReq.asset})`. The client does not have a registry
   to translate the hex into a name, so showing the hex is the
   right truth-level output for a verbose log.

These are display-only edits; the protocol payload, the actual
on-chain transfer, and the wire format are unchanged.

## Components

### `cli.ts` parser additions

Today's `cli.ts` defines optique parsers for each subcommand and
exports an `Args` union plus typed argument records (e.g.
`FundFiatArgs`). The change adds three new arg shapes:

- `FundUsdcFiatArgs` — same fields as today's `FundFiatArgs`
  (`address?: string` plus globals).
- `FundUsdcCryptoArgs` — same fields as today's `FundCryptoArgs`
  (`amount: string`, `chain: string`, `token?: string`,
  `eip7702: boolean` plus globals).
- `FundFastUsdArgs` — `to?: string`, `amount?: string` plus
  globals.

The original `FundFiatArgs` / `FundCryptoArgs` types are renamed in
place (no aliasing — internal-only project, breaking renames
acceptable per user direction).

### `main.ts` two-deep dispatch

`KNOWN_COMMANDS` keeps `"fund"`. `SUBCOMMANDS["fund"]` becomes
`["usdc", "fastusd"]` (a list of *first-level* subcommand
keywords). The dispatcher recognizes a third positional token when
`subcommand === "usdc"` and maps:

- `fund usdc fiat`   → registry cmd `"fund-usdc-fiat"`
- `fund usdc crypto` → registry cmd `"fund-usdc-crypto"`
- `fund fastusd`     → registry cmd `"fund-fastusd"`

`SUBCOMMAND_REQUIREMENTS` is keyed by the registry cmd string
(`"fund-usdc-fiat"`, etc.) — the existing flat-string scheme works
fine; only the dispatch routing changes shape. Unknown
combinations (`fund usdc bogus`, `fund bogus`) produce the same
shape of error that today's unknown subcommand produces (help
text + non-zero exit).

If the user types `fund usdc` with no third token, error with a
help message listing `fiat` and `crypto`.

### `commands/fund/fastusd.ts`

Mirrors the structure of [fund/fiat.ts](app/cli/src/commands/fund/fiat.ts):

```ts
const APP_BASE = "https://app.fast.xyz/send";

export const fundFastUsd: Command<FundFastUsdArgs> = {
  cmd: "fund-fastusd",
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const output = yield* Output;
      const config = yield* ClientConfig;

      if (config.network !== "mainnet") {
        return yield* Effect.fail(new InvalidUsageError({
          message:
            `fastUSD funding is only available on mainnet. ` +
            `Current network: ${config.network}. ` +
            `Switch with --network mainnet.`,
        }));
      }

      let address: string;
      if (args.to) {
        if (!args.to.startsWith("fast1")) {
          return yield* Effect.fail(new InvalidAddressError({
            message: `Invalid Fast address "${args.to}". Must start with fast1.`,
          }));
        }
        address = args.to;
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        address = account.fastAddress;
      }

      const params = new URLSearchParams({ to: address });
      if (args.amount !== undefined) {
        // Validate amount is a positive decimal; reuse existing parser pattern
        // (defer to plan task — see "amount validation" below)
        params.set("amount", args.amount);
      }
      const url = `${APP_BASE}?${params.toString()}`;

      yield* output.humanLine("Open this URL in your browser to fund your account:");
      yield* output.humanLine("");
      yield* output.humanLine(`  ${url}`);
      yield* output.humanLine("");
      yield* output.ok({ url, address });
    }),
};
```

**Amount validation.** Validate that `--amount`, if supplied, is
a non-empty positive decimal string. Reject `0`, negative, NaN,
empty. Don't try to enforce decimal precision (the web app
handles that). Errors use `InvalidAmountError`.

### `config/networks.json` — mainnet `fastTokens`

Mainnet entry gains a top-level `fastTokens` map (sibling of
`allset`). Testnet does not.

```jsonc
{
  "mainnet": {
    "url": "https://api.fast.xyz/proxy-rest",
    "explorerUrl": "https://explorer.fast.xyz",
    "networkId": "fast:mainnet",
    "allset": { /* unchanged */ },
    "fastTokens": {
      "fastUSD": {
        "fastTokenId": "0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb",
        "decimals": 6
      }
    }
  }
}
```

`decimals: 6` matches USDC and the standard for stablecoins.

### `schemas/networks.ts`

`BundledNetworksSchema` (Effect Schema) gains an optional
`fastTokens` field on each `NetworkConfig`. Shape:

```ts
fastTokens: Schema.optional(
  Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      fastTokenId: Schema.String, // 0x-prefixed 32-byte hex
      decimals: Schema.Number,
    }),
  }),
);
```

The optionality is real — testnet legitimately has none. Custom
user-added networks may also omit it.

### `services/token-resolver.ts`

Today's signature: `resolveToken(tokenName, networkConfig, chain?)
→ ResolvedToken`. Two changes:

1. **Without chain context** (`chain === undefined`): if
   `networkConfig.fastTokens?.[tokenName]` exists, return it
   directly. Otherwise fall through to today's per-chain scan
   (preserves testnet behavior).
2. **Default-token resolution** (caller passes a sentinel like
   `tokenName === undefined`): when neither chain nor token is
   given, return the network's preferred Fast-native default if
   one exists. Concretely: if `networkConfig.fastTokens` has
   exactly one entry, that entry is the default; if it has
   multiple, look for a key called `"fastUSD"`; if neither,
   fall back to today's "first chain's first token" rule.

**With chain context**: behavior unchanged — only
`allset.chains[chain].tokens` is consulted. `fastTokens` is
ignored on EVM-bridge paths because no EVM-side counterpart
exists.

**New helper for B2-fix (id → name).** Today's resolver maps
`name → id`. The pay.ts display/history fix needs the inverse:
given a `fastTokenId` hex from a server's payment requirement,
find the matching display name. Add a sibling helper
(`lookupTokenNameById(networkConfig, fastTokenId) → string |
undefined`) that scans both `fastTokens` and
`allset.chains[*].tokens` and returns the first key whose
`fastTokenId` matches. Returns `undefined` if no match — callers
fall back to the short hex / `"unknown"`.

The exact API shape (whether to add an explicit
`resolveDefaultToken(networkConfig)` helper or to fold the default
logic into `resolveToken` with a sentinel) will be decided in the
plan; the spec only fixes the *behavior*.

### `commands/send.ts` — mainnet default

Today, when `--token` is omitted on a Fast→Fast send, the resolver
scans the network's chains for the first token (typically
`testUSDC` on testnet, `USDC` on mainnet). After this change:

- Mainnet: returns `fastUSD` (sourced from `fastTokens.fastUSD`).
- Testnet: returns `testUSDC` (unchanged — no `fastTokens` on
  testnet).

The `--token` flag continues to override unconditionally; it
resolves first in `fastTokens`, then in chain-scoped tokens.

### `commands/pay.ts` and `packages/x402-client/src/fast.ts` — B2-fix

Three edits as described in the data-flow section above. The
[types.ts](packages/x402-client/src/types.ts) `X402PayResult.payment`
shape gains an `asset?: string` field carrying the actual asset hex
that the server demanded; `pay.ts` translates it to a name via
the network's token registry (or `"unknown"`).

The dry-run display fallback uses the same translator. The
verbose log in `fast.ts` shows the raw hex (no registry available
in the package).

## Error handling

| Scenario                                          | Error                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `fund fastusd` on testnet                         | `InvalidUsageError` (same shape as today's `fund usdc fiat`)       |
| `fund fastusd --to <bad>`                         | `InvalidAddressError` — must start with `fast1`                    |
| `fund fastusd --amount <bad>`                     | `InvalidAmountError` — non-empty positive decimal required         |
| `fund usdc <unknown-third-token>`                 | help-text + non-zero exit (matches today's unknown subcommand)     |
| `fund usdc` with no third token                   | help-text + non-zero exit                                          |
| `send` mainnet, no `--token`, `fastUSD` missing   | `TokenNotFoundError` after falling back to chain scan              |
| `pay` resolves an unknown asset hex               | display falls back to short hex; history `tokenName: "unknown"`    |

## Testing

Vitest from `app/cli/`:

- **`fund fastusd`** — URL shape (with/without `--amount`), default
  `--to` resolves to active account, explicit `--to` validation,
  mainnet-only error on testnet, JSON output shape.
- **`send` Fast→Fast token default** — mainnet returns `fastUSD`,
  testnet returns `testUSDC`, explicit `--token` overrides on both.
- **`token-resolver`** — `fastTokens` lookup wins over chain scan
  when no chain context; chain context still ignores `fastTokens`.
- **`pay`** — dry-run display and history `tokenName` reflect the
  actual server-supplied asset; unknown asset hex falls back to
  hex string / `"unknown"`.
- **Existing fund tests** — renamed and re-pathed for `fund usdc
  fiat` / `fund usdc crypto`; behavior assertions unchanged.

Vitest from `packages/x402-client/`:

- **`fast.ts` log line** — verbose log shows the raw asset hex,
  not `"USDC"`. (If there is no existing test for the verbose
  log, add a focused one.)

`tsc --noEmit` clean for `app/cli`, `packages/fast-sdk`, and
`packages/x402-client`.

## Doc sync

- [skills/fast/SKILL.md](skills/fast/SKILL.md) — update the
  funding-flow section, command tables (~L84-86, L98, L172, L270,
  L288, L303), token-name guidance, and any walkthrough that
  invokes `fund fiat` / `fund crypto`.
- [app/cli/README.md](app/cli/README.md) — update sections at
  L38-42 (quickstart), L243-275 (command reference), L386-390
  (end-to-end example), and `--token` defaults wherever mentioned.
- Scan [README.md](README.md) and [SPEC.md](SPEC.md) for stale
  `fund fiat` / `fund crypto` / `testUSDC` / `USDC` defaults.
  Update only if there's a real reference; do not invent new
  sections.

After editing each `.md` file, run `pnpm dlx markdownlint-cli
--fix <file>` per the global formatting rule.

## Build sequence

A coarse ordering for the implementation plan to refine:

1. **Schema and config first.** Extend
   `BundledNetworksSchema` with optional `fastTokens`; add the
   mainnet entry to `networks.json`. Land this with no consumers
   to keep the diff narrow.
2. **Token resolver extension.** Implement the `fastTokens`
   lookup and default-token logic. Add resolver tests.
3. **`send` Fast→Fast default.** Wire the resolver change into
   `send.ts`. Add tests.
4. **B2-fix in `x402-client`.** Surface `asset` on
   `X402PayResult.payment`; update verbose log. Tests.
5. **B2-fix in `pay.ts`.** Use `asset` for history + display. Tests.
6. **`fund` restructure.** Move files, add `fundFastUsd`, update
   `cli.ts` parsers, `commands/index.ts` registry, and
   `main.ts` dispatch (this is the biggest single change). Tests.
7. **Doc sync.** SKILL.md, README, scan SPEC. Markdownlint.
8. **Cross-cutting review.** `tsc --noEmit`, full vitest, manual
   sanity check of `fast fund fastusd` URL output.

One commit per task, conventional-style messages (`feat(cli): ...`,
`refactor(cli): ...`, `chore(cli): ...`, `docs(cli): ...`).
