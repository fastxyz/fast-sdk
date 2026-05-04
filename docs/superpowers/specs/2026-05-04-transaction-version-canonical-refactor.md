# TransactionVersionRegistry → canonical LatestTransaction refactor

**Status:** approved, pending implementation
**Author:** Yuqing Zhai
**Date:** 2026-05-04

## Background

`packages/fast-schema/src/interface/transaction-registry.ts` uses a registry indexed by version string (`'Release20260319' | 'Release20260407'`) with imperative `wrapOperations` / `extractOperations` methods to handle each version's payload-shape differences (`{ claim }` vs `{ claims: [] }`).

It works, but has three drawbacks:

1. **Stringly dispatched.** `getTransactionVersionConfig(version: string)` accepts any string and throws at runtime on unknown — no type-system exhaustiveness.
2. **Imperative inside a declarative-schema package.** The wrap/extract methods sit awkwardly next to `Schema.X` declarations; Effect Schema's transform story isn't expressive enough to derive both directions from the structural definition, so the methods are hand-rolled.
3. **No data migration / canonical view.** Each version stays its own branded type in TypeScript-land. There's no canonical "give me the operations regardless of version" type, so consumers that want to treat all versioned transactions uniformly have no good option.

A latent correctness gap also exists today: the SDK accepts an Escrow operation in a `Release20260319` transaction (Escrow only exists in `Release20260407+`); the registry doesn't enforce per-version operation membership, so the bad transaction round-trips to the validator and is rejected there. The wallet user sees an opaque late-stage error.

The Rust side solves the same problem differently: `fastset-rust-sdk/src/versioned_transactions/latest.rs` defines `latest::Transaction` (the canonical internal type), with 130 `From<...>` impls upgrading per-release types into it. Validator business logic operates on `latest::Transaction`; per-version dispatch happens once at deserialization. We mirror this pattern.

## Goals

- Replace the imperative registry with bidirectional `Schema.transformOrFail` bridges between each release form and a canonical `LatestTransaction`.
- Type-system enforcement of per-version operation membership: a `TransactionBuilder<'Release20260319'>` cannot accept Escrow operations at compile time.
- Defense-in-depth runtime enforcement at both the builder's `add()` boundary AND the encoder's downcast.
- Linear scaling: adding a new release version is a single `VersionBridges` entry plus a new bridge schema and per-version Operation enum — no edits to existing builder methods or consumers.
- Two consumers (`fast-sdk/src/interface/transaction.ts:178`, `x402-facilitator/src/fast-bcs.ts:10,65,293-294`) migrated; old registry deleted.

## Non-goals

- Dropping the `make<X>(palette)` factory pattern. The factory generics are gnarly (~13 type parameters per factory) and the user has flagged this as future cleanup, but it's a separate, larger refactor that warrants its own brainstorming pass. This spec keeps the palette pattern as-is and uses the existing factories.
- Mirroring Rust's per-version individual Operation types (`TokenTransferRelease20260319` vs `TokenTransferRelease20260407` as separate types when structurally identical). We share individual operation schemas where their fields don't differ; only the **Operation enum membership** is per-version.
- Restructuring BCS layout serialization. Bridges sit above the BCS layer.

## Architecture: bidirectional bridges + canonical type

### The four-piece picture

```
┌──────────────────────────────────────────────────────────────┐
│  Per-version bridges (bidirectional Schema.transformOrFail)  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   TransactionRelease20260319    LatestTransaction            │
│         (source)                    (target)                 │
│            │                          │                      │
│            │   ─── decode (upcast) ─→ │   always succeeds    │
│            │                          │                      │
│            │ ←── encode (downcast) ── │   may fail if        │
│            │                          │   canonical uses     │
│                                       │   features 20260319  │
│                                       │   doesn't support    │
│                                                              │
│   Same shape:                                                │
│     LatestFromRelease20260407                                │
│        (essentially identity passthrough — current latest)   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                       │
                       │ composed into
                       ▼
┌──────────────────────────────────────────────────────────────┐
│           Top-level entrypoints                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Decode (no version param — auto-dispatch):                  │
│    LatestFromVersionedTransaction                            │
│      decode VersionedTransaction → Latest                    │
│      (matches on tag, applies appropriate bridge)            │
│                                                              │
│  Encode (version param required):                            │
│    encodeAsVersion(latest, version) → versioned wire form    │
│      (picks the matching bridge, calls Schema.encode)        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                       │
                       │ enumeration / typed dispatch
                       ▼
┌──────────────────────────────────────────────────────────────┐
│   VersionBridges record — single source of truth for         │
│   "what versions exist + what each one supports"             │
└──────────────────────────────────────────────────────────────┘
```

### Key consequences

1. **Canonical is its own schema** (`LatestTransaction`), structurally identical to `TransactionRelease20260407` today but free to diverge later. Lives in `composite/latest.ts`.
2. **Bridges own the version-pair knowledge.** Each `LatestFromRelease<XXX>` bridge knows how to upcast its release form, how to downcast canonical to it, and which canonical operations are NOT supported.
3. **Type-level operation gating.** Per-version `Operation` enum schemas (e.g. `OperationRelease20260319` excludes Escrow). `TransactionRelease20260319.claims` is typed as `OperationRelease20260319[]`. Builder methods narrow on `OperationFor<V>`.
4. **Runtime defense-in-depth.** Builder's `add()` runtime-checks against `supportedOperations`; encoder's downcast catches anything that bypasses the type system.
5. **Linear scaling.** Adding `Release20270101` requires: define its Operation enum, define its bridge, add a `VersionBridges` entry. Builder methods, capability checks, encoder dispatch — all derived.
6. **Old registry deleted.** Both consumers migrate.

## Files

### New files

```
packages/fast-schema/src/composite/
  operations-per-version.ts        ← OperationRelease20260319 (excl. Escrow)
                                     OperationRelease20260407 (incl. Escrow)
                                     plus per-version ClaimType where they differ
                                     uses existing make<Op>(palette) factories
  latest.ts                        ← LatestTransaction schema (canonical)
  latest-bridges.ts                ← LatestFromRelease20260319, LatestFromRelease20260407
                                     LatestFromVersionedTransaction
                                     VersionBridges record
                                     SupportedTransactionVersions tuple

packages/fast-schema/src/interface/
  encode-as-version.ts             ← encodeAsVersion(latest, version) function

packages/fast-schema/tests/unit/composite/
  operations-per-version.test.ts   ← per-version Operation enum membership tests
  latest-bridges.test.ts           ← per-bridge round-trip + downcast-failure cases
                                     dispatcher dispatch tests
                                     SupportedOperations drift guards
```

### Modified files

```
packages/fast-schema/src/
  index.ts                         ← export new symbols, drop registry exports
  interface/index.ts               ← drop TransactionVersionRegistry / getTransactionVersionConfig

packages/fast-sdk/src/interface/
  transaction.ts                   ← TransactionBuilder<V extends TransactionVersion> param
                                     add() typed via OperationFor<V>
                                     addX wrappers narrow per V
                                     sign() uses encodeAsVersion(latest, version)

packages/fast-sdk/tests/...
  transaction-builder-types.test.ts (new) ← compile-only @ts-expect-error checks

packages/x402-facilitator/src/
  fast-bcs.ts                      ← decode site uses LatestFromVersionedTransaction
                                     KNOWN_VERSIONS uses SupportedTransactionVersions
```

### Deleted files

```
packages/fast-schema/src/interface/transaction-registry.ts
packages/fast-schema/tests/unit/interface/transaction-registry.test.ts
```

## Components

### `composite/operations-per-version.ts`

Per-version Operation enum schemas. Individual operation schemas (TokenTransfer, Mint, etc.) are shared across versions — only enum membership differs. Co-located with each enum: a `Release<XXX>SupportedOperations` literal tuple of the supported tags, type-checked against the enum via `satisfies`.

```ts
export const OperationRelease20260319 = TypedVariant({
  TokenTransfer: TokenTransferFromBcs,
  TokenCreation: TokenCreationFromBcs,
  TokenManagement: TokenManagementFromBcs,
  Mint: MintFromBcs,
  Burn: BurnFromBcs,
  StateInitialization: StateInitializationFromBcs,
  StateUpdate: StateUpdateFromBcs,
  StateReset: StateResetFromBcs,
  ExternalClaim: ExternalClaimFromBcs,
  LeaveCommittee: null,
  // …no Escrow
});

export const Release20260319SupportedOperations = [
  'TokenTransfer', 'TokenCreation', 'TokenManagement',
  'Mint', 'Burn', 'StateInitialization', 'StateUpdate',
  'StateReset', 'ExternalClaim', 'LeaveCommittee',
] as const satisfies readonly (typeof OperationRelease20260319.Type)['type'][];

export const OperationRelease20260407 = TypedVariant({
  /* …same as above plus: */
  Escrow: EscrowFromBcs,
});

export const Release20260407SupportedOperations = [
  /* …same as 20260319 plus: */
  'Escrow',
] as const satisfies readonly (typeof OperationRelease20260407.Type)['type'][];
```

Drift between the enum and the tuple is caught by a unit test (see Testing).

### `composite/latest.ts`

```ts
import { OperationRelease20260407 } from './operations-per-version.ts';

// Canonical Transaction = current latest (Release20260407) shape.
// Future: when a new release lands, re-alias or re-define here.
export const LatestTransaction = CamelCaseStruct({
  network_id: ...,
  sender: ...,
  nonce: ...,
  timestamp_nanos: ...,
  claims: Schema.Array(OperationRelease20260407),
  archival: Schema.Boolean,
  fee_token: Schema.NullOr(...),
});

export type LatestTransaction = typeof LatestTransaction.Type;
export type Operation = (typeof OperationRelease20260407.Type);  // canonical Operation
```

### `composite/latest-bridges.ts`

Per-version bridges, the dispatcher, and the typed registry.

```ts
import { ParseResult, Schema } from 'effect';
import { TransactionRelease20260319FromBcs, TransactionRelease20260407FromBcs }
  from './transaction.ts';
import { LatestTransaction } from './latest.ts';
import {
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from './operations-per-version.ts';
import { VersionedTransactionFromBcs } from '../palette/bcs.ts';

// --- Per-version bridges ---------------------------------------------------

export const LatestFromRelease20260319 = Schema.transformOrFail(
  TransactionRelease20260319FromBcs,
  LatestTransaction,
  {
    strict: true,
    decode: (release319, _opts, ast) => {
      // UPCAST — total mapping
      // claim → claims (single op stays single, {Batch: [a,b]} → [a, b])
      // ...returns ParseResult.succeed(latestTx)
    },
    encode: (latest, _opts, ast) => {
      // DOWNCAST — partial
      // Reject if any claim is not in Release20260319SupportedOperations
      const unsupported = latest.claims.find(
        op => !Release20260319SupportedOperations.includes(op.type as never)
      );
      if (unsupported) {
        return ParseResult.fail(new ParseResult.Type(ast, latest,
          `Operation '${unsupported.type}' is not supported by Release20260319`));
      }
      // claims → claim (single → bare op, multiple → {Batch: [...]})
      // ...returns ParseResult.succeed(release319Form)
    },
  },
);

export const LatestFromRelease20260407 = Schema.transformOrFail(
  TransactionRelease20260407FromBcs,
  LatestTransaction,
  {
    strict: true,
    decode: /* essentially identity (canonical IS this version today) */,
    encode: /* essentially identity */,
  },
);

// --- Typed registry --------------------------------------------------------

export const VersionBridges = {
  Release20260319: {
    schema: LatestFromRelease20260319,
    supportedOperations: Release20260319SupportedOperations,
  },
  Release20260407: {
    schema: LatestFromRelease20260407,
    supportedOperations: Release20260407SupportedOperations,
  },
} as const satisfies Record<TransactionVersion, BridgeEntry>;

export type SupportedOpTagFor<V extends TransactionVersion> =
  typeof VersionBridges[V]['supportedOperations'][number];

export type OperationFor<V extends TransactionVersion> =
  Extract<Operation, { type: SupportedOpTagFor<V> }>;

export const SupportedTransactionVersions =
  Object.keys(VersionBridges) as readonly TransactionVersion[];

// --- Dispatcher ------------------------------------------------------------

// Auto-dispatch decoder. Encode direction refuses (use encodeAsVersion).
export const LatestFromVersionedTransaction = Schema.transformOrFail(
  VersionedTransactionFromBcs,
  LatestTransaction,
  {
    strict: true,
    decode: (vt, _opts, ast) => {
      // vt is a tagged union: { Release20260319: ... } | { Release20260407: ... }
      // Match on the discriminator key, dispatch to VersionBridges[version].schema's decode
    },
    encode: (_latest, _opts, ast) =>
      ParseResult.fail(new ParseResult.Type(ast, _latest,
        'LatestFromVersionedTransaction does not encode — use encodeAsVersion(latest, version) which requires an explicit target version')),
  },
);
```

### `interface/encode-as-version.ts`

```ts
import { Schema } from 'effect';
import { VersionBridges } from '../composite/latest-bridges.ts';
import type { LatestTransaction } from '../composite/latest.ts';
import type { TransactionVersion } from './internal.ts';

/**
 * Encode a canonical LatestTransaction into a version-specific wire form.
 *
 * Throws ParseError if `latest` contains operations not supported by `version`
 * (e.g., encoding a Latest with an Escrow op as Release20260319 fails because
 * Escrow doesn't exist in 20260319's Operation enum).
 */
export function encodeAsVersion(
  latest: LatestTransaction,
  version: TransactionVersion,
): VersionedTransactionEncoded {
  const bridge = VersionBridges[version];
  const releaseSpecific = Schema.encodeSync(bridge.schema)(latest);
  // Wrap in the VersionedTransaction tagged-union form
  return { [version]: releaseSpecific } as VersionedTransactionEncoded;
}
```

### Builder rewrite (`fast-sdk/src/interface/transaction.ts`)

```ts
import { encodeAsVersion } from '@fastxyz/schema';
import {
  VersionBridges,
  type OperationFor,
  type LatestTransaction,
} from '@fastxyz/schema';

const LATEST_TRANSACTION_VERSION: TransactionVersion = 'Release20260407';

export class TransactionBuilder<V extends TransactionVersion = typeof LATEST_TRANSACTION_VERSION> {
  private collectedOps: OperationFor<V>[] = [];

  constructor(private readonly opts: {
    version?: V;
    signer: Signer;
    nonce: bigint;
    networkId: NetworkId;
    archival?: boolean;
    feeToken?: TokenId | null;
  }) {}

  // Type-safe primary entry — scales linearly: ONE method, all version logic in OperationFor<V>
  add(op: OperationFor<V>): this {
    const version = this.opts.version ?? (LATEST_TRANSACTION_VERSION as V);
    const bridge = VersionBridges[version];
    if (!bridge.supportedOperations.includes(op.type as never)) {
      throw new IncompatibleOperationError(
        `Operation '${op.type}' is not supported by ${version}`,
        { version, opType: op.type, supported: bridge.supportedOperations }
      );
    }
    this.collectedOps.push(op);
    return this;
  }

  // Convenience wrappers — narrow per V via OperationFor<V> membership check
  addTokenTransfer(p: TokenTransferParams): this { /* delegate to add() */ }
  addEscrow(
    p: EscrowParams,
  ): OperationFor<V> extends { type: 'Escrow' } ? this : never {
    return this.add({ type: 'Escrow', value: p } as never) as never;
  }
  // ...one wrapper per common op

  async sign(): Promise<TransactionEnvelope> {
    const version = this.opts.version ?? (LATEST_TRANSACTION_VERSION as V);
    const latest: LatestTransaction = {
      networkId: this.opts.networkId,
      sender: await this.opts.signer.getFastAddress(),
      nonce: this.opts.nonce,
      timestampNanos: BigInt(Date.now()) * 1_000_000n,
      claims: this.collectedOps as Operation[],
      archival: this.opts.archival ?? false,
      feeToken: this.opts.feeToken ?? null,
    };

    const versionedEncoded = encodeAsVersion(latest, version);
    // BCS-encode versionedEncoded → bytes; sign bytes → envelope
    // (existing flow continues from here)
  }
}
```

### Facilitator rewrite (`x402-facilitator/src/fast-bcs.ts`)

```ts
import {
  LatestFromVersionedTransaction,
  SupportedTransactionVersions,
} from '@fastxyz/schema';
import { Schema } from 'effect';

const KNOWN_VERSIONS = SupportedTransactionVersions;

// At the decode site (was lines 293-294):
const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(decoded);
const ops = latest.claims;
```

## Data flow

### Encode (wallet builds + signs)

1. User: `new TransactionBuilder<'Release20260319'>({ version: 'Release20260319', ... })`
2. User: `builder.add({ type: 'TokenTransfer', value: ... })` — type-checks against `OperationFor<'Release20260319'>`; runtime `supportedOperations` check passes.
3. User: `builder.addEscrow(...)` — TypeScript error: not in `OperationFor<'Release20260319'>`.
4. User: `await builder.sign()`:
   1. Build canonical `latest: LatestTransaction` from collected ops + common fields.
   2. Call `encodeAsVersion(latest, 'Release20260319')`:
      1. Look up `VersionBridges['Release20260319'].schema` (= `LatestFromRelease20260319`).
      2. `Schema.encode(bridge)(latest)` runs the bridge's encode (downcast):
         - Verify every op in `latest.claims` is in `Release20260319SupportedOperations`. If not, return `ParseResult.fail`.
         - Transform `claims: Operation[]` → `claim: ClaimType` (single op stays bare; multiple ops → `{Batch: [...]}`).
      3. Wrap in `{ Release20260319: <encoded> }`.
   3. BCS-encode the wrapped form → bytes.
   4. Sign bytes → `TransactionEnvelope`.

If step 4.ii.b's downcast fails (e.g., a runtime cast bypassed the type system), `Schema.encode` throws a `ParseError`; the builder converts to `IncompatibleOperationError`.

### Decode (facilitator extracts ops from BCS)

1. Facilitator receives BCS bytes.
2. BCS-decode → `versionedDecoded: VersionedTransactionEncoded`, shaped as `{ Release20260319: ... }` or `{ Release20260407: ... }`.
3. `Schema.decodeUnknownSync(LatestFromVersionedTransaction)(versionedDecoded)`:
   1. Match on the discriminator key.
   2. Dispatch to `VersionBridges[version].schema.decode` (the bridge's UPCAST direction).
   3. Each per-version bridge's decode:
      - Normalize `claim: ClaimType` → `claims: Operation[]` (wrap single op, unwrap `{Batch: [...]}`).
      - Return `LatestTransaction` shape.
4. `ops = latest.claims` — typed as canonical `Operation[]`.

Decode never fails on version dispatch. The only failure path is malformed wire data (separate, expected schema parse error).

## Testing strategy

### What needs new tests

**Per-version Operation enums** (`composite/operations-per-version.test.ts`):

| Test | Why |
|---|---|
| `OperationRelease20260319` decodes valid 20260319-allowed ops | Sanity |
| `OperationRelease20260319` rejects an Escrow-shaped object | Negative — proves Escrow is excluded |
| `OperationRelease20260407` decodes valid 20260407-allowed ops including Escrow | Sanity |
| `Release20260319SupportedOperations` tuple matches the union members at runtime | Drift guard for the `satisfies`-based tag tuples |
| Same drift guard for `Release20260407SupportedOperations` | |

**Bridges** (`composite/latest-bridges.test.ts`):

| Test | Why |
|---|---|
| `LatestFromRelease20260319.decode` upcasts `claim: TokenTransfer` → `claims: [TokenTransfer]` | Single-op normalization |
| `LatestFromRelease20260319.decode` upcasts `claim: { Batch: [a,b] }` → `claims: [a,b]` | Batch unwrapping |
| `LatestFromRelease20260319.decode` handles empty `claim: { Batch: [] }` correctly (or rejects per Rust validator behavior — verify against fastset before implementing) | Edge case |
| `LatestFromRelease20260319.encode` downcasts `claims: [single]` → `claim: single` (no Batch wrap) | Inverse of single-op upcast |
| `LatestFromRelease20260319.encode` downcasts `claims: [a, b]` → `claim: { Batch: [a, b] }` | Inverse of batch upcast |
| `LatestFromRelease20260319.encode` REJECTS canonical with an Escrow op (returns ParseError) | Downcast capability enforcement |
| `LatestFromRelease20260319.encode` REJECTS canonical with empty `claims: []` if 20260319 requires at least one (verify against fastset) | Edge case |
| `LatestFromRelease20260407` round-trip is identity (canonical == 20260407 today) | Sanity |
| Round-trip property: for every `latest` constructed from only `Release20260319SupportedOperations`, `decode(encode(latest))` equals `latest` (after normalization) | Symmetry |
| `LatestFromVersionedTransaction.decode` dispatches `{Release20260319: ...}` to the 20260319 bridge | Dispatch correctness |
| `LatestFromVersionedTransaction.decode` dispatches `{Release20260407: ...}` to the 20260407 bridge | Dispatch correctness |
| `LatestFromVersionedTransaction.encode` throws (no version param) | Documents the asymmetry |
| `encodeAsVersion(latest, 'Release20260319')` produces `{Release20260319: ...}` shape and rejects Escrow | End-to-end encode |
| `encodeAsVersion(latest, 'Release20260407')` produces `{Release20260407: ...}` shape and accepts Escrow | End-to-end encode |
| `SupportedTransactionVersions.length === Object.keys(VersionBridges).length` | Regression guard for new-version registration |

**TransactionBuilder** (extend existing tests):

| Test | Why |
|---|---|
| `TransactionBuilder<'Release20260319'>` rejects `addEscrow` at compile time (`@ts-expect-error` line) | Compile-only check |
| `TransactionBuilder<'Release20260319'>.add({ type: 'Escrow', ... } as never)` throws `IncompatibleOperationError` at runtime | Bypass-resistant runtime guard |
| `TransactionBuilder<'Release20260407'>.addEscrow(...)` succeeds and produces a transaction with Escrow encoded | Happy path |
| End-to-end round-trip: `build → sign → BCS-decode → LatestFromVersionedTransaction.decode` produces canonical with same ops | Integration |

**Facilitator** (extend existing tests):

| Test | Why |
|---|---|
| Decoded 20260319 transaction surfaces `latest.claims` as flat array | Dispatch via `LatestFromVersionedTransaction` |
| Decoded 20260407 transaction with Escrow surfaces Escrow in `latest.claims` | Cross-version op extraction |
| `KNOWN_VERSIONS` (now `SupportedTransactionVersions`) has expected entries | Regression |

### Compile-time test pattern

```ts
// packages/fast-sdk/tests/.../transaction-builder-types.test.ts
import { TransactionBuilder } from '../src/...';

// @ts-expect-error — addEscrow not available on TransactionBuilder<'Release20260319'>
new TransactionBuilder<'Release20260319'>({ /* ... */ }).addEscrow({ /* ... */ });

// Positive case (no @ts-expect-error — compiles fine):
new TransactionBuilder<'Release20260407'>({ /* ... */ }).addEscrow({ /* ... */ });
```

`tsc --noEmit` covering the test directory verifies the `@ts-expect-error` is satisfied.

### Verification commands

```
cd packages/fast-schema && pnpm exec vitest run
cd packages/fast-schema && pnpm exec tsc --noEmit
cd packages/fast-sdk && pnpm exec vitest run
cd packages/fast-sdk && pnpm exec tsc --noEmit
cd packages/x402-facilitator && pnpm exec tsc --noEmit
```

### Pass criteria

1. All new tests pass; existing schema/sdk tests don't regress.
2. `tsc --noEmit` clean across `fast-schema`, `fast-sdk`, `x402-facilitator`.
3. `transaction-registry.ts` and its test file deleted; no references remain in the workspace.
4. Runtime behavior of `TransactionBuilder.sign()` and facilitator BCS decode is unchanged for the existing happy-path scenarios.

## Out of scope (deferred)

- **Drop the palette factory pattern.** Separate brainstorming pass; flagged as user concern but out of scope here. See memory `project_fast_schema_cleanup_state.md`.
- **Per-version individual operation types** (e.g., `TokenTransferRelease20260319` vs `TokenTransferRelease20260407` as separate types). Mirroring Rust here would multiply schema work without proportional type-safety gain. Operation enum membership is the meaningful per-version distinction in TypeScript's structural typing.
- **Workspace pnpm linking** (item #12 in the cleanup debt list). Pre-existing, addressed when CI gating lands.
