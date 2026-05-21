# Multisig in fast-cli + fast-sdk Design

## Goal

Replace the standalone Rust `fastset-multisig-cli` by adding multisig
support to the TypeScript `fast-cli`, backed by a new
`MultiSigSigner` abstraction in `@fastxyz/sdk`. The CLI should expose
multisig with the same command interface as single-signer wherever
the operation is the same; only the signing path differs.

## Background

The `fast-cli` today is single-signer only. Accounts live in SQLite
at `~/.fast/fast.db`; signing uses the existing
[Signer](packages/fast-sdk/src/interface/signer.ts#L25) class.

The Rust `fastset-multisig-cli` provides 13 commands for N-of-M
multisig wallets: account+keystore management, multisig wallet
config, transaction initiation (transfer, mint, burn, create-token,
manage-token), and a partial-signature collection workflow
(`show-pending`, `vote`).

`@fastxyz/schema` and `@fastxyz/sdk` already include the on-wire
multisig primitives:

- `MultiSigConfig`, `MultiSig`, `SignatureOrMultiSig` BCS structs
  ([packages/fast-schema/src/base/bcs-layout.ts:17-31](packages/fast-schema/src/base/bcs-layout.ts#L17-L31))
- `getPendingMultisigTransactions` provider method
  ([packages/fast-sdk/src/interface/provider.ts:115](packages/fast-sdk/src/interface/provider.ts#L115))
- `submitTransaction` accepts the `SignatureOrMultiSig` envelope

What is missing: a higher-level signer abstraction symmetrical to
`Signer`, and the CLI surface that uses it.

## Architecture

Two layers change. The SDK gains one new abstraction
(`MultiSigSigner`) plus free helpers (`deriveMultiSigAddress`,
`assertAuthorizedSigner`). The CLI gains a unified
account model that treats single-signer keystores and multisig
wallet configs as two flavors of the same `accounts` row.

```text
fast-sdk
  interface/
    signer.ts          (existing — unchanged)
    multisig-signer.ts (NEW: MultiSigSigner + deriveMultiSigAddress)

fast-cli
  commands/
    account/    (modified: list/export aware of kind)
    send.ts     (polymorphic by account kind)
    token/      (NEW: create, mint, burn, manage — polymorphic)
    multisig/   (NEW: init, import, export, pending, vote)
  services/
    storage/account.ts   (extended: kind + multisigConfig)
    signer-resolver.ts   (NEW: row -> Signer | MultiSigSigner)
  schemas/multisig-wallet.ts (NEW)
  db/schema.ts             (modified: accounts gains kind cols)
```

`fast-schema` is unchanged.

### Data flow: `fast send 0xRecipient 100`

1. CLI loads active account row.
2. `resolveSigner(row)` returns `Signer` or `MultiSigSigner`
   depending on `row.kind`.
3. CLI builds the `TokenTransfer` operation, fetches nonce via
   `getAccountInfo`.
4. `signer.signTransaction(tx)` returns a `SignatureOrMultiSig` —
   either a bare `Signature` (single) or a `MultiSig` with one
   partial entry (multisig).
5. `submitTransaction(envelope)` returns `Success(cert)` or
   `IncompleteMultiSig`.
6. `reportResult` branches: cert hash + history persistence on
   success; "1/N signatures, cosigners run `fast multisig
pending`" on incomplete.

For `fast multisig vote`, the same shape applies; the only
difference from `send` is that the operation is loaded from the
proxy's pending list instead of being built locally.

## Data model

### Accounts table — tagged union

Current shape:

```text
accounts(name PK, fastAddress, evmAddress, encryptedKey BLOB,
         encrypted BOOL, isDefault BOOL)
```

New shape:

```text
accounts(
  name PK,
  kind TEXT NOT NULL,          -- 'single' | 'multisig'
  fastAddress TEXT NOT NULL,   -- derived for multisig
  evmAddress TEXT,             -- nullable; null for multisig
  encryptedKey BLOB,           -- nullable; null for multisig
  encrypted BOOL,              -- nullable; null for multisig
  multisigConfig TEXT,         -- nullable JSON; null for single
  isDefault BOOL
)
```

CHECK constraint: exactly one of `(encryptedKey, multisigConfig)`
is non-null, and `kind` matches.

A drizzle migration adds the columns and backfills `kind='single'`
for existing rows.

### Wallet config JSON

This is both the in-DB `multisigConfig` value and the
`export`/`import` file format:

```json
{
  "version": 1,
  "name": "treasury",
  "signers": ["fast1abc...", "fast1def...", "fast1ghi..."],
  "quorum": 2,
  "configNonce": "0",
  "fastAddress": "fast1xyz...",
  "network": "testnet"
}
```

- `signers` is bech32, sorted lexicographically (canonical form,
  matches the Rust derivation order).
- `configNonce` is a string (u64 may exceed
  `Number.MAX_SAFE_INTEGER`).
- `fastAddress` is included for round-trip verification on import.
- `network` records the network at creation time; CLI commands
  warn if the active network differs.
- `version: 1` lets us evolve later.

No new tables. No address book for external signers in v1; the
multisig wallet config itself stores signer addresses, displayed as
truncated bech32 with local-account name lookup when applicable.

## SDK: `MultiSigSigner`

New file: `packages/fast-sdk/src/interface/multisig-signer.ts`.

```ts
import type { MultiSigConfig, SignatureOrMultiSig } from '@fastxyz/schema';

export interface MultiSigSignerInit {
  config: MultiSigConfig;
  secretKey: Uint8Array; // Ed25519, must be one of the signers
}

export class MultiSigSigner {
  constructor(init: MultiSigSignerInit);
  getFastAddress(): Promise<string>;
  getSignerPublicKey(): Uint8Array;
  signTransaction(txMessage: Uint8Array): Promise<SignatureOrMultiSig>;
}

export function deriveMultiSigAddress(config: MultiSigConfig): Promise<string>;
export function assertAuthorizedSigner(config: MultiSigConfig, secretKey: Uint8Array): void;
```

**Signer invariants** are validated lazily on first operation that needs
the signer key/config relationship. Construction clones and stores the
config/secret; methods throw on violation:

- `secretKey` derives a pubkey present in
  `config.authorized_signers`.
- `config.quorum >= 1 && config.quorum <= signers.length`.
- `config.authorized_signers.length >= 2`.
- No duplicate signers.

**Address derivation** must match the Rust
`MultiSigConfig::address()` byte-for-byte. The reference algorithm
is in the `fastset-rust-sdk` crate. Cross-tool unit-test fixtures
guard against silent divergence.

**Signature output** is `SignatureOrMultiSig.MultiSig({ config,
signatures: [[myPubkey, sig]] })`. Single entry; the proxy
aggregates with other partials.

**Index export** in `packages/fast-sdk/src/index.ts`:

```ts
export { MultiSigSigner, deriveMultiSigAddress } from './interface/multisig-signer';
```

## CLI: signer resolution

New service `app/cli/src/services/signer-resolver.ts`:

```ts
type ResolvedSigner =
  | { kind: "single"; signer: Signer; account: AccountRow }
  | {
      kind: "multisig";
      signer: MultiSigSigner;
      account: AccountRow;        // the multisig wallet row
      memberAccount: AccountRow;  // the local single-signer used to sign
    };

resolveSigner(opts: {
  account: AccountRow;
  asMember?: string;   // --as <name>, multisig only
  password?: string;
}): Effect<ResolvedSigner, ...>;
```

**Behaviour:**

- `kind === 'single'`: unlock keystore, wrap in `Signer`, return.
- `kind === 'multisig'`:
  1. Parse `multisigConfig`.
  2. Find local accounts whose `fastAddress` is in
     `config.signers` — these are eligible "members".
  3. If `--as <name>` given: must be eligible.
  4. If exactly one eligible: use it.
  5. If multiple eligible and no `--as`: error
     (`AmbiguousMember`).
  6. Unlock that member's keystore, construct
     `MultiSigSigner({config, secretKey})`.
  7. Return both the multisig wallet row and the member row.

### Polymorphic command pattern

Every operation command (`send`, `token create/mint/burn/manage`)
follows:

```text
loadActiveAccount(opts)
  -> resolveSigner({account, asMember, password})
  -> buildOp(opts)            // operation-specific
  -> attachNonce(fastAddress) // getAccountInfo
  -> sign(signer)
  -> submit
  -> reportResult             // Success vs IncompleteMultiSig
```

Only `buildOp` differs per command. The signer/submit/report path
is shared.

`reportResult`:

- `Success(cert)`: prints cert hash + explorer URL, persists to
  `history` table.
- `IncompleteMultiSig`: prints "submitted as multisig partial,
  K/quorum signatures, cosigners run `fast multisig
pending`/`vote`". Does **not** write to `history` (no cert yet).

### `--memo` flag

On `token create` and `token manage`. Single helper
`encodeUserData(string?): UserData | null` validates <=32 bytes UTF-8
and zero-pads. `send`, `token mint`, and `token burn` do not expose
`--memo`.

## Commands

`+` denotes new. `~` denotes modified. Operations under
"Operations (polymorphic)" work for both single-signer and
multisig accounts.

### Account & keystore

- `fast account create` — unchanged
- `fast account import` — unchanged
- `~ fast account list` — adds `kind` column (`single` or
  `multisig N-of-M`)
- `~ fast account export <name>` — errors on multisig with a
  pointer to `fast multisig export`
- `fast account set-default` — unchanged
- `~ fast account delete <name>` — works for both kinds; for
  multisig deletes only the wallet config row

### Network — all unchanged

### Info — all unchanged

### Operations (polymorphic)

```text
~ fast send <recipient> <amount>
    [--token <id|name>]
    [--account <name>] [--as <name>]
    [--password <pwd>] [--non-interactive] [--yes] [--json]
```

```text
+ fast token create
    --name <string> --decimals <0-18> --initial-supply <amount>
    [--minters <addr,...>] [--memo <string>]
    [--account ...] [--as ...] [--password ...]
```

Active account becomes admin.

```text
+ fast token mint
    --token <id|name> --to <addr> --amount <amount>
    [--account ...] [--as ...]
```

Active account must be in the token's authorized minters.

```text
+ fast token burn
    --token <id|name> --amount <amount>
    [--account ...] [--as ...]
```

Burns from active account's holdings.

```text
+ fast token manage
    --token <id|name>
    [--admin <addr>]
    [--add-minters <addr,...>]
    [--remove-minters <addr,...>]
    [--memo <string>]
    [--account ...] [--as ...]
```

At least one of `--admin / --add-minters / --remove-minters`
required. Active account must be the current admin.

### Funding & pay — all unchanged

### Multisig coordination

```text
+ fast multisig init
    --signers <addr|name,...> --quorum <n> --config-nonce <n>
    --name <alias> [--network <name>] [--set-default] [--json]
```

Signer arguments accept either bech32 addresses or local-account
names (resolved to addresses).

```text
+ fast multisig import
    ( --from <file.json>
    | --signers <addr,...> --quorum <n> --config-nonce <n>
      [--expect-address <addr>] )
    [--name <alias>] [--network <name>] [--set-default] [--json]
```

On `--from`: validates `version`, recomputes address against
`fastAddress` field, rejects mismatches.

```text
+ fast multisig export <name> [--out <path>] [--json]
```

Emits the canonical wallet-config JSON to stdout (or `--out` file).

```text
+ fast multisig pending [--account <name>] [--as <name>] [--json]
```

Lists pending txs at the wallet's current nonce. Each row shows
operation summary, signer grid (✓/✗ with local name resolution),
and whether _you_ still need to vote.

```text
+ fast multisig vote
    [--tx <hash>] [--account <name>] [--as <name>]
    [--password <pwd>] [--non-interactive] [--yes] [--json]
```

Auto-picks the pending tx if exactly one; requires `--tx` if
multiple. Refuses if the resolved member has already signed.

## Phasing

Two implementation phases, each its own plan/PR:

**Phase 1 — multisig backbone.** SDK `MultiSigSigner` + helpers,
accounts schema migration, signer-resolver service, `fast multisig
init/import/export/pending/vote`, polymorphic `fast send`,
`account list/export/delete` updates. End state: end-to-end usable
N-of-M wallet for transfers.

**Phase 2 — token operations.** `fast token
create/mint/burn/manage`. Each command is mostly an `Operation`
builder reusing Phase 1's polymorphic dispatch. Works for both
single-signer and multisig from day one — no second-pass refactor.

The split is organizational; the architecture does not change
between phases.

## Error taxonomy

All extend the existing tagged-error pattern in
`app/cli/src/errors`:

- `MultiSigConfigInvalid` — quorum/count/duplicate violations
- `NotAMember` — caller's local account isn't in
  `authorized_signers`
- `AmbiguousMember` — multiple local accounts match; `--as`
  required
- `AddressDerivationMismatch` — import file's `fastAddress` ≠
  recomputed
- `AlreadyVoted` — caller's pubkey already in pending tx's
  signatures
- `WalletKindMismatch` — operation requires single (e.g. `account
export`) but row is multisig, or vice versa
- `IncompleteMultiSigSubmission` — not an error per se, but a
  result variant the CLI surfaces distinctly from `Success`

## Testing

**SDK unit tests** (`packages/fast-sdk/tests/unit/`):

- `MultiSigSigner` constructor invariants (rejects bad config,
  non-member key)
- `deriveMultiSigAddress` against fixed Rust-generated vectors
  (committed JSON fixtures)
- Sign + BCS round-trip

**CLI unit tests**:

- `signer-resolver` matrix: single account; multisig with 0/1/many
  local members; `--as` resolution; password handling
- JSON wallet-config schema parse/validate, `version` rejection
- Migration: existing single-signer rows backfill `kind='single'`

**CLI integration tests** (existing pattern):

- 2-of-3 happy path: `multisig init` → `send` → second-member
  `vote` → `Success`
- `vote` refuses double-sign
- `send` against multisig with no local member key → clear error
- `multisig import --from` with mismatched address → reject
- `account export` on multisig → friendly error

**Cross-tool fixture test:** address-derivation vectors generated
by the Rust tool, stored as JSON, asserted in TS unit tests.

## File plan

**New files:**

- `packages/fast-sdk/src/interface/multisig-signer.ts`
- `packages/fast-sdk/tests/unit/multisig-signer.test.ts`
- `packages/fast-sdk/tests/unit/fixtures/multisig-addresses.json`
- `app/cli/src/services/signer-resolver.ts`
- `app/cli/src/schemas/multisig-wallet.ts`
- `app/cli/src/commands/multisig/{init,import,export,pending,vote,index}.ts`
- `app/cli/src/commands/token/{create,mint,burn,manage,index}.ts` _(Phase 2)_
- `app/cli/drizzle/<timestamp>_multisig_accounts.sql`

**Modified files:**

- `packages/fast-sdk/src/index.ts`
- `app/cli/src/db/schema.ts`
- `app/cli/src/services/storage/account.ts`
- `app/cli/src/services/api/fast.ts` (add
  `getPendingMultisigTransactions` wrapper if not already
  present)
- `app/cli/src/commands/account/{list,export}.ts`
- `app/cli/src/commands/send.ts`
- `app/cli/src/cli.ts`, `app/cli/src/main.ts`
- `app/cli/src/errors/*`
- Changesets: minor for `@fastxyz/sdk`, appropriate bump for the
  CLI

## Out of scope

- YAML parameter files (Rust-style). Flags and prompts cover the
  same ground; not a stated need.
- Address book for external (non-keystore) signer aliases.
  Truncated bech32 with local-account name fallback is sufficient
  for v1.
- Encryption upgrade (current AES-CTR + scrypt). Out of scope; can
  be revisited as a separate effort.
- Offline signature aggregation. The proxy is the rendezvous,
  matching the Rust tool's flow.
