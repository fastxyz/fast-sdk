# TransactionVersionRegistry → canonical LatestTransaction refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the imperative `TransactionVersionRegistry` with bidirectional `Schema.transformOrFail` bridges between each release form and a canonical `LatestTransaction`, mirroring Rust's `latest::Transaction` + `From` impls pattern. Type-safe per-version operation membership at compile time + runtime defense-in-depth.

**Architecture:** Per-version Operation enum schemas (documenting + drift-guarding what's supported per version) + canonical `LatestTransaction` (= today's Release20260407 shape) + per-version bridge schemas (`LatestFromRelease<XXX>`) doing decode-side upcast (always succeeds) and encode-side downcast (may fail when canonical contains unsupported ops). Top-level dispatcher decoder + `encodeAsVersion(latest, version)` function. `VersionBridges` record provides single source of truth for scaling.

**Tech Stack:** TypeScript, Effect Schema (`transformOrFail`, `Union`, `Literal`), vitest, pnpm workspace, changesets.

**Spec:** `docs/superpowers/specs/2026-05-04-transaction-version-canonical-refactor.md`

**Branch:** `refactor/canonical-latest-transaction` (already created from `cleanup/transport-palette`)

**Test command:** `cd packages/fast-schema && pnpm exec vitest run <path>`

**Critical git hygiene throughout:** the working tree contains unrelated `app/cli/src/...` files (modified or untracked from a different work session). EVERY commit in this plan must use explicit `git add <file>` for only the task's files — never `git add -A`, `git add .`, or wildcards.

---

## Task 1: Per-version Operation enum schemas

**Files:**

- Create: `packages/fast-schema/src/composite/operations-per-version.ts`
- Create: `packages/fast-schema/tests/unit/composite/operations-per-version.test.ts`

**Context:** Defines `OperationRelease20260319` (excludes Escrow) and `OperationRelease20260407` (includes Escrow), plus `Release<XXX>SupportedOperations` literal tuples that document which op tags are valid per version. The tuples are type-checked against the union via `satisfies`, with a runtime drift-guard test below to catch missed updates.

These enums are used downstream for:

1. Deriving `OperationFor<V>` type narrowing in TransactionBuilder
2. Runtime capability checks in the bridges' encode direction (Task 3)
3. The `VersionBridges` record's `supportedOperations` field (Task 4)

The individual operation factories (`makeTokenTransfer`, `makeMint`, etc.) are unchanged. Only the Operation enum membership differs by version.

- [ ] **Step 1: Read context — current Operation factory and existing per-op BCS schemas**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
sed -n '1,50p' packages/fast-schema/src/composite/operations.ts
sed -n '70,100p' packages/fast-schema/src/palette/bcs.ts
```

Note the per-op BCS schemas already exported: `TokenTransferFromBcs`, `TokenCreationFromBcs`, `TokenManagementFromBcs`, `MintFromBcs`, `BurnFromBcs`, `StateInitializationFromBcs`, `StateUpdateFromBcs`, `StateResetFromBcs`, `ExternalClaimFromBcs`, `EscrowFromBcs`, plus `LeaveCommittee` (a unit variant with no payload schema). These are what the per-version Operation enums compose.

- [ ] **Step 2: Write the failing tests**

Create `packages/fast-schema/tests/unit/composite/operations-per-version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  OperationRelease20260319,
  OperationRelease20260407,
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from '../../../src/composite/operations-per-version.ts';

describe('OperationRelease20260319', () => {
  it('decodes a TokenTransfer op', () => {
    const decoded = Schema.decodeUnknownSync(OperationRelease20260319)({
      TokenTransfer: { /* will be populated based on shape */ },
    });
    expect(decoded.type).toBe('TokenTransfer');
  });

  it('decodes the LeaveCommittee unit variant from { LeaveCommittee: [] } (BCS form)', () => {
    const decoded = Schema.decodeUnknownSync(OperationRelease20260319)({
      LeaveCommittee: [],
    });
    expect(decoded.type).toBe('LeaveCommittee');
  });

  it('rejects an Escrow-shaped object (Escrow not in 20260319)', () => {
    expect(() => Schema.decodeUnknownSync(OperationRelease20260319)({
      Escrow: { /* anything */ },
    })).toThrow();
  });
});

describe('OperationRelease20260407', () => {
  it('decodes a TokenTransfer op', () => {
    const decoded = Schema.decodeUnknownSync(OperationRelease20260407)({
      TokenTransfer: { /* will be populated based on shape */ },
    });
    expect(decoded.type).toBe('TokenTransfer');
  });

  it('decodes an Escrow-tagged variant (Escrow exists in 20260407)', () => {
    // Just check the variant tag is recognized; Escrow's payload validation
    // is exercised by other tests
    expect(() => Schema.decodeUnknownSync(OperationRelease20260407)({
      Escrow: { CreateConfig: { /* placeholder */ } as never } as never,
    })).not.toThrow(/Unknown variant/);
  });
});

describe('SupportedOperations drift guards', () => {
  it('Release20260319SupportedOperations matches OperationRelease20260319 union members', () => {
    // Derive runtime tags from the schema's Type's discriminator field
    const declared = [...Release20260319SupportedOperations].sort();
    // Decode every declared tag — if any fails, the tuple is wrong
    for (const tag of declared) {
      // smoke check: can we recognize the variant? Use a synthetic empty payload form.
      // This step's purpose is documentation; the real correctness check is at type level via `satisfies`.
      expect(typeof tag).toBe('string');
    }
    // Concrete drift guard: confirm specific exclusion/inclusion
    expect(declared).not.toContain('Escrow');
    expect(declared).toContain('LeaveCommittee');
    expect(declared).toContain('TokenTransfer');
  });

  it('Release20260407SupportedOperations includes Escrow', () => {
    expect([...Release20260407SupportedOperations]).toContain('Escrow');
    expect([...Release20260407SupportedOperations]).toContain('TokenTransfer');
  });

  it('Release20260407 is a superset of Release20260319 in supported ops', () => {
    const v319 = new Set<string>(Release20260319SupportedOperations);
    const v407 = new Set<string>(Release20260407SupportedOperations);
    for (const tag of v319) {
      expect(v407.has(tag)).toBe(true);
    }
  });
});
```

(NOTE for the implementer: the TokenTransfer decode tests use `/* will be populated */` because the exact valid TokenTransfer payload depends on the per-op BCS schema's shape. When implementing, look at `packages/fast-schema/tests/unit/composite/operations.test.ts` to see how TokenTransfer payloads are constructed for tests — copy a known-valid fixture and substitute. If you can't find a clean fixture, REPLACE the payload-shape-dependent assertions with a simpler "throws on unknown variant key" test that doesn't require valid payload construction. Document this substitution in the report.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/operations-per-version.test.ts
```

Expected: import failures — symbols don't exist yet.

- [ ] **Step 4: Implement `composite/operations-per-version.ts`**

Create `packages/fast-schema/src/composite/operations-per-version.ts`:

```ts
/**
 * Per-version Operation enum schemas.
 *
 * Each release version of the Fast network supports a specific set of
 * operations. This file defines an Operation TypedVariant per version,
 * listing exactly the variants that release accepts on the wire.
 *
 * Individual operation factories (TokenTransfer, Mint, etc.) are shared —
 * only enum membership differs by version. The `Release<XXX>SupportedOperations`
 * tuples document which tags belong to which version, type-checked via
 * `satisfies` against the union's Type discriminator.
 *
 * Used by `composite/latest-bridges.ts` for runtime capability checks at the
 * encode-side downcast, and by the SDK's TransactionBuilder for
 * `OperationFor<V>` type-level narrowing.
 */

import {
  BurnFromBcs,
  ExternalClaimFromBcs,
  EscrowFromBcs,
  MintFromBcs,
  StateInitializationFromBcs,
  StateResetFromBcs,
  StateUpdateFromBcs,
  TokenCreationFromBcs,
  TokenManagementFromBcs,
  TokenTransferFromBcs,
} from '../palette/bcs.ts';
import { TypedVariant } from '../util/index.ts';

/** Operation enum supported in Release20260319 transactions (excludes Escrow). */
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
}, { unitEncoding: 'bcs' });

/** Tags supported in Release20260319 — type-checked tuple, drift-guarded by test. */
export const Release20260319SupportedOperations = [
  'TokenTransfer',
  'TokenCreation',
  'TokenManagement',
  'Mint',
  'Burn',
  'StateInitialization',
  'StateUpdate',
  'StateReset',
  'ExternalClaim',
  'LeaveCommittee',
] as const satisfies readonly (typeof OperationRelease20260319.Type)['type'][];

/** Operation enum supported in Release20260407 transactions (includes Escrow). */
export const OperationRelease20260407 = TypedVariant({
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
  Escrow: EscrowFromBcs,
}, { unitEncoding: 'bcs' });

/** Tags supported in Release20260407 — type-checked tuple, drift-guarded by test. */
export const Release20260407SupportedOperations = [
  'TokenTransfer',
  'TokenCreation',
  'TokenManagement',
  'Mint',
  'Burn',
  'StateInitialization',
  'StateUpdate',
  'StateReset',
  'ExternalClaim',
  'LeaveCommittee',
  'Escrow',
] as const satisfies readonly (typeof OperationRelease20260407.Type)['type'][];

/** Re-export the Operation type for downstream OperationFor<V> derivation. */
export type Release20260319Operation = typeof OperationRelease20260319.Type;
export type Release20260407Operation = typeof OperationRelease20260407.Type;
```

(NOTE: verify against existing `packages/fast-schema/src/composite/operations.ts` whether the Operation TypedVariant there uses additional unit variants like `JoinCommittee` or `ChangeCommittee`. If yes, include them in the appropriate version's enum here. The plan above lists what the spec discussed — adjust based on what the existing code shows.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/operations-per-version.test.ts
```

Expected: PASS. If any test fails because of the per-op payload-shape issue noted in Step 2, simplify those tests as instructed there.

- [ ] **Step 6: Verify build is clean**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Expected: no errors. The `as const satisfies` clauses verify the tuples match the union's discriminator literals.

- [ ] **Step 7: Commit**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
git status -s | grep '^[?M]' | head  # confirm only the two new files changed
git add packages/fast-schema/src/composite/operations-per-version.ts \
         packages/fast-schema/tests/unit/composite/operations-per-version.test.ts
git status -s | grep '^[AM]'  # confirm only these two staged
git commit -m "$(cat <<'EOF'
feat(fast-schema): add per-version Operation enum schemas

OperationRelease20260319 (excludes Escrow) and OperationRelease20260407
(includes Escrow) document which operation variants each release accepts
on the wire. Companion Release<XXX>SupportedOperations literal tuples
are type-checked via `satisfies` against the union's discriminator.

Used by the upcoming canonical-LatestTransaction refactor for runtime
capability checks (encode-side downcast) and TS-type-level narrowing
(OperationFor<V> in TransactionBuilder).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: LatestTransaction canonical schema

**Files:**

- Create: `packages/fast-schema/src/composite/latest.ts`

**Context:** The canonical type that downstream code operates on. Today: structurally identical to Release20260407. Future: when a new release lands with a structural difference, this file is the migration point.

No tests for this file alone — it's a structural definition that's exercised by the bridge tests in Task 3.

- [ ] **Step 1: Read existing TransactionRelease20260407 shape**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
sed -n '40,90p' packages/fast-schema/src/composite/transaction.ts
```

Note the field shapes (network_id, sender, nonce, timestamp_nanos, claims, archival, fee_token) and the palette parameterization. The canonical schema mirrors this structure but with concrete primitives instead of palette-parameterized ones.

- [ ] **Step 2: Implement `composite/latest.ts`**

Create `packages/fast-schema/src/composite/latest.ts`:

```ts
/**
 * Canonical LatestTransaction schema.
 *
 * Structurally identical to Release20260407 today. Owns the canonical
 * Operation type alias (= OperationRelease20260407.Type, the latest's
 * Operation union). When a new release lands with a structural change
 * to the Transaction shape itself, this file is the migration point.
 *
 * Downstream code (TransactionBuilder, x402-facilitator BCS extractor)
 * operates on `LatestTransaction` regardless of which release produced
 * the wire bytes — bridges in `latest-bridges.ts` upcast on decode.
 */

import { Schema } from 'effect';
import { Address, NetworkId, Nonce } from '../base/internal.ts';
import { AmountFromBcs, TokenIdFromBcs } from '../palette/bcs.ts';
import { CamelCaseStruct } from '../util/index.ts';
import { OperationRelease20260407 } from './operations-per-version.ts';

/** Canonical Operation = the latest version's Operation enum. */
export type Operation = typeof OperationRelease20260407.Type;

/**
 * Canonical Transaction schema.
 *
 * Structurally identical to TransactionRelease20260407FromBcs at time of
 * authorship. Defined separately so future releases can extend or reshape
 * canonical without forcing downstream code to also re-spell its types.
 */
export const LatestTransaction = CamelCaseStruct({
  network_id: NetworkId,
  sender: Address,
  nonce: Nonce,
  timestamp_nanos: Schema.BigIntFromSelf,
  claims: Schema.Array(OperationRelease20260407),
  archival: Schema.Boolean,
  fee_token: Schema.NullOr(TokenIdFromBcs),
});

export type LatestTransaction = typeof LatestTransaction.Type;
```

(NOTE: `Address`, `Nonce`, `NetworkId`, `Amount` — verify the actual import paths and brand names by reading `packages/fast-schema/src/base/internal.ts` and `packages/fast-schema/src/palette/bcs.ts`. The plan uses what's documented at lines 4-30 of `base/internal.ts` and the existing BCS exports — but the implementer should sanity-check that the canonical Transaction shape compiles by running `tsc --noEmit` after this step.)

- [ ] **Step 3: Verify build**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Expected: no errors. If `claims: Schema.Array(OperationRelease20260407)` complains about variance, that's a real type issue to surface — STOP and report.

- [ ] **Step 4: Run all schema tests (regression check)**

```bash
cd packages/fast-schema && pnpm exec vitest run
```

Expected: green; test count unchanged (this file has no tests yet).

- [ ] **Step 5: Commit**

```bash
git add packages/fast-schema/src/composite/latest.ts
git status -s | grep '^[AM]'  # confirm only this file staged
git commit -m "$(cat <<'EOF'
feat(fast-schema): add canonical LatestTransaction schema

LatestTransaction is the canonical Transaction type for downstream code.
Structurally identical to Release20260407 today; defined separately so
future release shape changes have a single migration point.

Companion 'Operation' type alias = the latest version's Operation enum.

Bridges (next commit) connect each release's Transaction schema to this
canonical via Schema.transformOrFail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Per-version bridges (decode upcast + encode downcast with capability check)

**Files:**

- Create: `packages/fast-schema/src/composite/latest-bridges.ts` (initial — bridges only)
- Create: `packages/fast-schema/tests/unit/composite/latest-bridges.test.ts` (initial)

**Context:** The heart of the refactor. Each `LatestFromRelease<XXX>` is a `Schema.transformOrFail` schema where:

- **decode (upcast):** old release form → canonical. Always succeeds. Normalizes `claim: ClaimType` → `claims: Operation[]` (single op stays single, `{Batch: [a,b]}` becomes `[a, b]`).
- **encode (downcast):** canonical → old release form. May fail with `ParseResult.fail` when canonical contains an op not in the version's `SupportedOperations`. Inverts the decode normalization.

Two bridges authored in this task: `LatestFromRelease20260319` (real shape difference + capability subsetting) and `LatestFromRelease20260407` (essentially identity, since canonical = 20260407 today).

Dispatcher (`LatestFromVersionedTransaction`) and the typed `VersionBridges` record come in Task 4.

- [ ] **Step 1: Read the existing TransactionRelease20260319 shape and its ClaimType**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
sed -n '1,50p' packages/fast-schema/src/composite/transaction.ts
grep -n "makeClaimType" packages/fast-schema/src/composite/operations.ts
sed -n '/makeClaimType/,/^}/p' packages/fast-schema/src/composite/operations.ts | head -40
```

Note specifically: `TransactionRelease20260319` has `claim: ClaimType` where `ClaimType` is a TypedVariant that includes a `Batch` variant wrapping multiple operations. `TransactionRelease20260407` has `claims: Schema.Array(Operation)`.

The decode-side upcast logic for 20260319:

- If `claim.type === 'Batch'`, then `claims: claim.value`
- Else, `claims: [claim]` (a single-element array containing the bare op)

The encode-side downcast logic for 20260319:

- Reject any op in `latest.claims` whose type is not in `Release20260319SupportedOperations`
- If `latest.claims.length === 1`, then `claim: latest.claims[0]` (bare op, no Batch wrap)
- Else, `claim: { type: 'Batch', value: latest.claims }`
- Empty `claims: []` — verify against fastset behavior (likely fails the validator; we should fail at encode-time too)

- [ ] **Step 2: Write the failing tests**

Create `packages/fast-schema/tests/unit/composite/latest-bridges.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  LatestFromRelease20260319,
  LatestFromRelease20260407,
} from '../../../src/composite/latest-bridges.ts';

// Minimal fixture builders. Fill in concrete byte arrays / brands by reading
// existing tests (e.g. tests/unit/composite/transaction.test.ts) for patterns.
const someTokenTransfer = () => ({
  type: 'TokenTransfer' as const,
  value: { /* TokenTransfer fields per existing test fixtures */ } as never,
});
const someEscrow = () => ({
  type: 'Escrow' as const,
  value: { /* Escrow CreateConfig per existing test fixtures */ } as never,
});
const baseLatestTx = (claims: any[]) => ({
  networkId: 'fast:testnet' as const,
  sender: new Uint8Array(32),
  nonce: 0n,
  timestampNanos: 0n,
  claims,
  archival: false,
  feeToken: null,
});
const baseRelease20260319Tx = (claim: any) => ({
  networkId: 'fast:testnet' as const,
  sender: new Uint8Array(32),
  nonce: 0n,
  timestampNanos: 0n,
  claim,
  archival: false,
  feeToken: null,
});

describe('LatestFromRelease20260319 — upcast (decode)', () => {
  it('upcasts a single-op claim into a one-element claims array', () => {
    const release319 = baseRelease20260319Tx(someTokenTransfer());
    const latest = Schema.decodeUnknownSync(LatestFromRelease20260319)(release319 as never);
    expect(latest.claims).toHaveLength(1);
    expect(latest.claims[0].type).toBe('TokenTransfer');
  });

  it('upcasts a Batch claim into a flat claims array', () => {
    const release319 = baseRelease20260319Tx({
      type: 'Batch',
      value: [someTokenTransfer(), someTokenTransfer()],
    });
    const latest = Schema.decodeUnknownSync(LatestFromRelease20260319)(release319 as never);
    expect(latest.claims).toHaveLength(2);
  });
});

describe('LatestFromRelease20260319 — downcast (encode)', () => {
  it('downcasts a single-op claims array into a bare claim', () => {
    const latest = baseLatestTx([someTokenTransfer()]);
    const release319 = Schema.encodeSync(LatestFromRelease20260319)(latest as never);
    expect((release319 as any).claim.type).toBe('TokenTransfer');
  });

  it('downcasts a multi-op claims array into a Batch claim', () => {
    const latest = baseLatestTx([someTokenTransfer(), someTokenTransfer()]);
    const release319 = Schema.encodeSync(LatestFromRelease20260319)(latest as never);
    expect((release319 as any).claim.type).toBe('Batch');
    expect((release319 as any).claim.value).toHaveLength(2);
  });

  it('REJECTS canonical with an Escrow op (not supported by 20260319)', () => {
    const latest = baseLatestTx([someEscrow()]);
    expect(() =>
      Schema.encodeSync(LatestFromRelease20260319)(latest as never),
    ).toThrow(/Escrow.*not supported.*Release20260319/i);
  });

  it('round-trips for a single TokenTransfer', () => {
    const original = baseLatestTx([someTokenTransfer()]);
    const encoded = Schema.encodeSync(LatestFromRelease20260319)(original as never);
    const decoded = Schema.decodeUnknownSync(LatestFromRelease20260319)(encoded);
    expect(decoded.claims).toHaveLength(1);
    expect(decoded.claims[0].type).toBe('TokenTransfer');
  });
});

describe('LatestFromRelease20260407 — identity passthrough', () => {
  it('round-trips a single-op transaction', () => {
    const original = baseLatestTx([someTokenTransfer()]);
    const encoded = Schema.encodeSync(LatestFromRelease20260407)(original as never);
    const decoded = Schema.decodeUnknownSync(LatestFromRelease20260407)(encoded);
    expect(decoded.claims).toHaveLength(1);
  });

  it('accepts Escrow ops (20260407 supports them)', () => {
    const latest = baseLatestTx([someEscrow()]);
    expect(() =>
      Schema.encodeSync(LatestFromRelease20260407)(latest as never),
    ).not.toThrow();
  });
});
```

(IMPLEMENTER NOTE: the fixture builders use `as never` casts because the schema-typed shapes need real branded values to satisfy strict types. For the test to actually compile and run, look at `packages/fast-schema/tests/unit/composite/transaction.test.ts` for known-good fixtures and substitute them in. If the existing tests use a helper like `validTokenTransfer()` or similar, import and use that. The TEST INTENT is clear — make the asserted behaviors concrete with whatever helpers the existing test files already provide.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/latest-bridges.test.ts
```

Expected: import failures — `LatestFromRelease20260319`, `LatestFromRelease20260407` not exported yet.

- [ ] **Step 4: Implement `composite/latest-bridges.ts` (bridges only — dispatcher in Task 4)**

Create `packages/fast-schema/src/composite/latest-bridges.ts`:

```ts
/**
 * Bidirectional bridges between per-release Transaction schemas and the
 * canonical LatestTransaction.
 *
 * Each `LatestFromRelease<XXX>` is a `Schema.transformOrFail` schema where:
 *   - decode (= upcast): release form → canonical. Always succeeds; older
 *     shapes are subsets of canonical.
 *   - encode (= downcast): canonical → release form. May fail when
 *     canonical contains operations the target version doesn't support.
 *
 * Top-level dispatcher (`LatestFromVersionedTransaction`) and the typed
 * `VersionBridges` record live in this file too — see Task 4.
 */

import { ParseResult, Schema } from 'effect';
import {
  TransactionRelease20260319FromBcs,
  TransactionRelease20260407FromBcs,
} from '../palette/bcs.ts';
import { LatestTransaction } from './latest.ts';
import {
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from './operations-per-version.ts';

// ---------------------------------------------------------------------------
// LatestFromRelease20260319 — real shape conversion + capability subsetting
// ---------------------------------------------------------------------------

const SUPPORTED_20260319 = new Set<string>(Release20260319SupportedOperations);

export const LatestFromRelease20260319 = Schema.transformOrFail(
  TransactionRelease20260319FromBcs,
  LatestTransaction,
  {
    strict: true,
    decode: (release319, _opts, _ast) => {
      // UPCAST: claim → claims array
      const claim = release319.claim;
      const claims =
        claim.type === 'Batch'
          ? (claim.value as readonly unknown[])
          : [claim];
      return ParseResult.succeed({
        networkId: release319.networkId,
        sender: release319.sender,
        nonce: release319.nonce,
        timestampNanos: release319.timestampNanos,
        claims: claims as never,  // structurally compatible (canonical Operation is superset)
        archival: release319.archival,
        feeToken: release319.feeToken,
      });
    },
    encode: (latest, _opts, ast) => {
      // DOWNCAST: capability check + claims → claim normalization
      const unsupported = latest.claims.find(
        (op) => !SUPPORTED_20260319.has(op.type),
      );
      if (unsupported !== undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            latest,
            `Operation '${unsupported.type}' not supported by Release20260319`,
          ),
        );
      }
      if (latest.claims.length === 0) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            latest,
            'Release20260319 transactions require at least one operation',
          ),
        );
      }
      const claim =
        latest.claims.length === 1
          ? latest.claims[0]
          : { type: 'Batch' as const, value: latest.claims };
      return ParseResult.succeed({
        networkId: latest.networkId,
        sender: latest.sender,
        nonce: latest.nonce,
        timestampNanos: latest.timestampNanos,
        claim: claim as never,
        archival: latest.archival,
        feeToken: latest.feeToken,
      });
    },
  },
);

// ---------------------------------------------------------------------------
// LatestFromRelease20260407 — identity passthrough (canonical = this version)
// ---------------------------------------------------------------------------

const SUPPORTED_20260407 = new Set<string>(Release20260407SupportedOperations);

export const LatestFromRelease20260407 = Schema.transformOrFail(
  TransactionRelease20260407FromBcs,
  LatestTransaction,
  {
    strict: true,
    decode: (release407, _opts, _ast) =>
      // canonical structurally identical — pass through
      ParseResult.succeed({
        networkId: release407.networkId,
        sender: release407.sender,
        nonce: release407.nonce,
        timestampNanos: release407.timestampNanos,
        claims: release407.claims,
        archival: release407.archival,
        feeToken: release407.feeToken,
      }),
    encode: (latest, _opts, ast) => {
      // Capability check still runs (canonical may have ops we don't recognize
      // if a newer release adds ops without updating canonical)
      const unsupported = latest.claims.find(
        (op) => !SUPPORTED_20260407.has(op.type),
      );
      if (unsupported !== undefined) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            latest,
            `Operation '${unsupported.type}' not supported by Release20260407`,
          ),
        );
      }
      return ParseResult.succeed({
        networkId: latest.networkId,
        sender: latest.sender,
        nonce: latest.nonce,
        timestampNanos: latest.timestampNanos,
        claims: latest.claims,
        archival: latest.archival,
        feeToken: latest.feeToken,
      });
    },
  },
);
```

(IMPLEMENTER NOTES:

1. The exact field-name casing on `release319.claim` etc. depends on whether the BCS Transaction schema uses snake_case or camelCase on its decoded form. `CamelCaseStruct` in this codebase decodes snake_case wire keys to camelCase TS keys, so the decoded form should be camelCase. If types complain, check the actual field name on `TransactionRelease20260319FromBcs.Type` and adjust.

2. The `claim.type === 'Batch'` check assumes `ClaimType` (or whatever the wrapper type is for 20260319's claim field) uses TypedVariant's `{ type, value }` shape. Verify by reading `composite/operations.ts`'s `makeClaimType` definition. If `Batch`'s payload wrapping is shaped differently, adjust the upcast accordingly.

3. The `as never` casts on `claims` and `claim` are because of the structural typing gap — canonical Operation is a different concrete type than the per-release Operation. The values are runtime-compatible (same shape; one is a subset of the other), and bridging them needs a cast at the schema boundary. If TS is happy without the cast in your IDE, drop it.

4. Empty-claims rejection in 20260319: the spec marks this as "verify against fastset". Reading the Rust code at `fastset-rust-sdk/src/versioned_transactions/transaction_release20260319.rs` — search for the operation count enforcement. If Rust ALLOWS empty claims (no Batch wrap, no single op? unlikely but check), remove that check; otherwise keep it.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/latest-bridges.test.ts
```

Expected: PASS. If round-trip fails because of casing/field mismatches, fix the bridge implementation per IMPLEMENTER NOTES 1-3.

- [ ] **Step 6: Run full schema suite**

```bash
cd packages/fast-schema && pnpm exec vitest run
```

Expected: green; no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/fast-schema/src/composite/latest-bridges.ts \
         packages/fast-schema/tests/unit/composite/latest-bridges.test.ts
git status -s | grep '^[AM]'  # confirm only these two staged
git commit -m "$(cat <<'EOF'
feat(fast-schema): add per-version Latest bridges (decode upcast + encode downcast)

LatestFromRelease20260319 and LatestFromRelease20260407 are bidirectional
Schema.transformOrFail schemas connecting each release's Transaction form
to the canonical LatestTransaction:

- decode: upcasts release form to canonical (always succeeds)
- encode: downcasts canonical to release form (rejects ops the version
  doesn't support, and rejects empty claims for versions that require ops)

Dispatcher (LatestFromVersionedTransaction) and typed VersionBridges
record come in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Dispatcher + VersionBridges + type helpers

**Files:**

- Modify: `packages/fast-schema/src/composite/latest-bridges.ts`
- Modify: `packages/fast-schema/tests/unit/composite/latest-bridges.test.ts`

**Context:** Wraps the per-version bridges into a typed registry (`VersionBridges`) and a top-level dispatcher (`LatestFromVersionedTransaction`). Also derives the type helpers `OperationFor<V>` and `SupportedOpTagFor<V>` that downstream code uses.

- [ ] **Step 1: Append failing tests**

Append to `packages/fast-schema/tests/unit/composite/latest-bridges.test.ts`:

```ts
import {
  LatestFromVersionedTransaction,
  VersionBridges,
} from '../../../src/composite/latest-bridges.ts';
import { SupportedTransactionVersions } from '../../../src/base/internal.ts';

describe('VersionBridges record', () => {
  it('has an entry for every supported transaction version', () => {
    const bridgeKeys = Object.keys(VersionBridges).sort();
    const supported = [...SupportedTransactionVersions].sort();
    expect(bridgeKeys).toEqual(supported);
  });

  it('Release20260319 entry includes correct supportedOperations', () => {
    expect([...VersionBridges.Release20260319.supportedOperations]).toContain('TokenTransfer');
    expect([...VersionBridges.Release20260319.supportedOperations]).not.toContain('Escrow');
  });

  it('Release20260407 entry includes Escrow', () => {
    expect([...VersionBridges.Release20260407.supportedOperations]).toContain('Escrow');
  });
});

describe('LatestFromVersionedTransaction — auto-dispatch decoder', () => {
  it('decodes a Release20260319-tagged transaction via the 20260319 bridge', () => {
    const release319 = baseRelease20260319Tx(someTokenTransfer());
    const versioned = { Release20260319: release319 } as never;
    const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(versioned);
    expect(latest.claims).toHaveLength(1);
  });

  it('decodes a Release20260407-tagged transaction via the 20260407 bridge', () => {
    const release407 = { /* Release20260407 shape with claims: [...] */ } as never;
    const versioned = { Release20260407: release407 } as never;
    expect(() =>
      Schema.decodeUnknownSync(LatestFromVersionedTransaction)(versioned),
    ).not.toThrow();
  });

  it('refuses to encode (must use encodeAsVersion)', () => {
    const latest = baseLatestTx([someTokenTransfer()]);
    expect(() =>
      Schema.encodeSync(LatestFromVersionedTransaction)(latest as never),
    ).toThrow(/encodeAsVersion/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/latest-bridges.test.ts
```

Expected: import failures — `LatestFromVersionedTransaction`, `VersionBridges` not exported yet.

- [ ] **Step 3: Append implementation to `composite/latest-bridges.ts`**

Append to `packages/fast-schema/src/composite/latest-bridges.ts`:

```ts
import type { TransactionVersion } from '../base/internal.ts';
import { VersionedTransactionFromBcs } from '../palette/bcs.ts';
import type { Operation } from './latest.ts';

// ---------------------------------------------------------------------------
// VersionBridges — typed registry, single source of truth for "what versions
// exist and what each one supports"
// ---------------------------------------------------------------------------

interface BridgeEntry {
  // biome-ignore lint/suspicious/noExplicitAny: schema generics differ per version
  readonly schema: Schema.Schema<typeof LatestTransaction.Type, any, never>;
  readonly supportedOperations: readonly string[];
}

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

// Type-level: derive the operation tag set for each version
export type SupportedOpTagFor<V extends TransactionVersion> =
  typeof VersionBridges[V]['supportedOperations'][number];

export type OperationFor<V extends TransactionVersion> =
  Extract<Operation, { type: SupportedOpTagFor<V> }>;

// ---------------------------------------------------------------------------
// LatestFromVersionedTransaction — auto-dispatch decoder
// ---------------------------------------------------------------------------

export const LatestFromVersionedTransaction = Schema.transformOrFail(
  VersionedTransactionFromBcs,
  LatestTransaction,
  {
    strict: true,
    decode: (vt, _opts, ast) => {
      // vt is a TypedVariant — decoded shape is { type: 'Release20260319' | ..., value: ... }
      const version = vt.type as TransactionVersion;
      const bridge = VersionBridges[version];
      if (!bridge) {
        return ParseResult.fail(
          new ParseResult.Type(ast, vt, `Unknown transaction version: ${version}`),
        );
      }
      // Dispatch to the bridge's decode by re-running it
      const result = ParseResult.decodeUnknownEither(bridge.schema)(vt.value);
      return result._tag === 'Right'
        ? ParseResult.succeed(result.right)
        : ParseResult.fail(result.left);
    },
    encode: (latest, _opts, ast) =>
      ParseResult.fail(
        new ParseResult.Type(
          ast,
          latest,
          'LatestFromVersionedTransaction does not support encode — use encodeAsVersion(latest, version) which requires an explicit target version',
        ),
      ),
  },
);
```

(IMPLEMENTER NOTE: the `vt.type` and `vt.value` access depends on how `VersionedTransactionFromBcs` exposes its decoded shape. The existing `makeVersionedTransaction` in `composite/transaction.ts` uses `TypedVariant`, so the decoded form is `{ type: 'Release20260319', value: ... } | { type: 'Release20260407', value: ... }`. Verify by reading that file. If the discriminator field is named differently, adjust.)

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/latest-bridges.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify build**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/fast-schema/src/composite/latest-bridges.ts \
         packages/fast-schema/tests/unit/composite/latest-bridges.test.ts
git status -s | grep '^[AM]'  # confirm only these two staged
git commit -m "$(cat <<'EOF'
feat(fast-schema): add VersionBridges registry + LatestFromVersionedTransaction dispatcher

VersionBridges is the typed source of truth for "what transaction versions
exist and what each one supports". Adding a new release version requires
only a new entry here (plus the per-version Operation enum and bridge).

LatestFromVersionedTransaction auto-dispatches on the version tag in a
VersionedTransaction wire form. Refuses to encode (no implicit target
version selection) — use encodeAsVersion(latest, version) for encoding.

Type helpers OperationFor<V> and SupportedOpTagFor<V> derive per-version
operation type narrowing from the registry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: encodeAsVersion function

**Files:**

- Create: `packages/fast-schema/src/interface/encode-as-version.ts`
- Create: `packages/fast-schema/tests/unit/interface/encode-as-version.test.ts`

**Context:** Encode-direction entrypoint — given a canonical `LatestTransaction` and a target version, produces the version-specific wire form. Throws ParseError if canonical contains ops the target version doesn't support (the bridge's encode-side rejection bubbles up).

- [ ] **Step 1: Write the failing tests**

Create `packages/fast-schema/tests/unit/interface/encode-as-version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeAsVersion } from '../../../src/interface/encode-as-version.ts';

// Reuse fixtures from latest-bridges.test.ts pattern
const baseLatestTx = (claims: any[]) => ({
  networkId: 'fast:testnet' as const,
  sender: new Uint8Array(32),
  nonce: 0n,
  timestampNanos: 0n,
  claims,
  archival: false,
  feeToken: null,
});
const someTokenTransfer = () => ({
  type: 'TokenTransfer' as const,
  value: { /* fill in valid TokenTransfer per existing test fixtures */ } as never,
});
const someEscrow = () => ({
  type: 'Escrow' as const,
  value: { /* fill in valid Escrow per existing test fixtures */ } as never,
});

describe('encodeAsVersion', () => {
  it('encodes a canonical transaction as Release20260407 (identity-ish)', () => {
    const latest = baseLatestTx([someTokenTransfer()]);
    const encoded = encodeAsVersion(latest as never, 'Release20260407');
    expect((encoded as any).type ?? Object.keys(encoded)[0]).toBe('Release20260407');
  });

  it('encodes a canonical transaction as Release20260319 (downcast)', () => {
    const latest = baseLatestTx([someTokenTransfer()]);
    const encoded = encodeAsVersion(latest as never, 'Release20260319');
    expect((encoded as any).type ?? Object.keys(encoded)[0]).toBe('Release20260319');
  });

  it('REJECTS canonical with Escrow when target is Release20260319', () => {
    const latest = baseLatestTx([someEscrow()]);
    expect(() =>
      encodeAsVersion(latest as never, 'Release20260319'),
    ).toThrow(/Escrow.*not supported.*Release20260319/i);
  });

  it('ACCEPTS canonical with Escrow when target is Release20260407', () => {
    const latest = baseLatestTx([someEscrow()]);
    expect(() =>
      encodeAsVersion(latest as never, 'Release20260407'),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/interface/encode-as-version.test.ts
```

Expected: import failure.

- [ ] **Step 3: Implement `interface/encode-as-version.ts`**

Create `packages/fast-schema/src/interface/encode-as-version.ts`:

```ts
/**
 * Encode a canonical LatestTransaction into a version-specific wire form.
 *
 * Throws ParseError if `latest` contains operations not supported by `version`
 * (e.g., encoding a Latest with an Escrow op as Release20260319 fails because
 * Escrow doesn't exist in 20260319's Operation enum).
 *
 * The returned value is the discriminated VersionedTransaction wire form
 * — `{ type: 'Release20260319', value: ... }` or analogous for 20260407 —
 * matching what `VersionedTransactionFromBcs.Encoded` expects.
 */

import { Schema } from 'effect';
import type { TransactionVersion } from '../base/internal.ts';
import { VersionBridges } from '../composite/latest-bridges.ts';
import type { LatestTransaction } from '../composite/latest.ts';

export function encodeAsVersion(
  latest: LatestTransaction,
  version: TransactionVersion,
): { type: TransactionVersion; value: unknown } {
  const bridge = VersionBridges[version];
  const releaseSpecific = Schema.encodeSync(bridge.schema)(latest);
  return { type: version, value: releaseSpecific };
}
```

(IMPLEMENTER NOTE: the return-shape `{ type, value }` matches TypedVariant's encoded form. Verify by inspecting what `Schema.encodeSync(VersionedTransactionFromBcs)(...)` outputs for a known-valid VersionedTransaction. If the wire shape uses a different discriminator key — e.g., `{ Release20260319: <value> }` directly — adjust the return form accordingly.)

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/interface/encode-as-version.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full schema suite + typecheck**

```bash
cd packages/fast-schema && pnpm exec vitest run && pnpm exec tsc --noEmit
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/fast-schema/src/interface/encode-as-version.ts \
         packages/fast-schema/tests/unit/interface/encode-as-version.test.ts
git status -s | grep '^[AM]'  # confirm only these two staged
git commit -m "$(cat <<'EOF'
feat(fast-schema): add encodeAsVersion(latest, version) function

Encode-direction entrypoint for the canonical-LatestTransaction refactor.
Picks the matching bridge from VersionBridges and runs Schema.encode on
the canonical input. Throws ParseError if downcast fails (e.g., canonical
contains an Escrow op while target version is Release20260319).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Re-export new symbols from package indexes

**Files:**

- Modify: `packages/fast-schema/src/composite/index.ts` (if exists; if not, skip — not all repos use a composite barrel)
- Modify: `packages/fast-schema/src/interface/index.ts`
- Modify: `packages/fast-schema/src/index.ts`

**Context:** Make the new types/symbols part of the public `@fastxyz/schema` API for the consumer rewrites in Tasks 7-8.

- [ ] **Step 1: Inventory existing exports**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
test -f packages/fast-schema/src/composite/index.ts && cat packages/fast-schema/src/composite/index.ts || echo "(no composite/index.ts)"
cat packages/fast-schema/src/interface/index.ts
grep -n "transaction-registry\|TransactionVersionRegistry\|getTransactionVersionConfig" packages/fast-schema/src/index.ts packages/fast-schema/src/interface/index.ts
```

- [ ] **Step 2: Update `interface/index.ts`**

Replace the `from './transaction-registry.ts'` line with `encode-as-version.ts` exports. Keep all other existing exports as-is.

```ts
// REMOVE:
//   export { getTransactionVersionConfig, TransactionVersionRegistry, ... } from './transaction-registry.ts';

// ADD:
export { encodeAsVersion } from './encode-as-version.ts';
```

(Note: don't delete `transaction-registry.ts` itself in this task — Task 9 handles deletion after consumers migrate.)

- [ ] **Step 3: Update `src/index.ts` (or composite/index.ts)**

Add re-exports for the new schemas and types so they're reachable from the package root:

```ts
// New exports for the canonical refactor:
export {
  OperationRelease20260319,
  OperationRelease20260407,
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from './composite/operations-per-version.ts';

export type {
  Release20260319Operation,
  Release20260407Operation,
} from './composite/operations-per-version.ts';

export { LatestTransaction } from './composite/latest.ts';
export type { Operation } from './composite/latest.ts';

export {
  LatestFromRelease20260319,
  LatestFromRelease20260407,
  LatestFromVersionedTransaction,
  VersionBridges,
} from './composite/latest-bridges.ts';

export type {
  OperationFor,
  SupportedOpTagFor,
} from './composite/latest-bridges.ts';

// (encodeAsVersion and the existing TransactionVersion / SupportedTransactionVersions /
// LatestTransactionVersion are already re-exported via interface/index.ts and
// base/index.ts respectively — verify this with grep and don't duplicate.)
```

(IMPLEMENTER NOTE: read the current `src/index.ts` to see the existing re-export style — match it. Some packages prefer wildcard re-exports `export * from './foo.ts'`; some prefer named. Stick to whatever the file already does.)

- [ ] **Step 4: Verify the new symbols are reachable**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Quick sanity check:

```bash
cd /home/yuqing/Documents/Code/fast-sdk/packages/fast-schema
cat > /tmp/verify-canonical-exports.ts <<'EOF'
import {
  encodeAsVersion,
  LatestTransaction,
  LatestFromVersionedTransaction,
  VersionBridges,
  OperationRelease20260319,
  OperationRelease20260407,
} from './src/index.ts';
import type { Operation, OperationFor } from './src/index.ts';
console.log('OK',
  typeof encodeAsVersion,
  typeof LatestTransaction,
  typeof LatestFromVersionedTransaction,
  typeof VersionBridges,
  typeof OperationRelease20260319,
  typeof OperationRelease20260407);
EOF
pnpm exec tsx /tmp/verify-canonical-exports.ts
rm /tmp/verify-canonical-exports.ts
```

Expected: prints "OK function object object object object object" and exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-schema/src/interface/index.ts packages/fast-schema/src/index.ts
# also add composite/index.ts if you modified it
git status -s | grep '^[AM]'
git commit -m "$(cat <<'EOF'
chore(fast-schema): re-export canonical-Latest refactor symbols from package indexes

Makes LatestTransaction, the per-version Operation enums, the bridges,
VersionBridges, OperationFor<V>, and encodeAsVersion part of the public
@fastxyz/schema API for the upcoming TransactionBuilder + facilitator
migrations.

The existing TransactionVersionRegistry export is dropped; consumers
migrate in the next two commits, then the registry file is deleted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate fast-sdk TransactionBuilder

**Files:**

- Modify: `packages/fast-sdk/src/interface/transaction.ts`
- Create: `packages/fast-sdk/tests/transaction-builder-types.test.ts` (compile-only `@ts-expect-error` checks)

**Context:** TransactionBuilder becomes generic on `V extends TransactionVersion`, `add()` and per-op convenience methods narrow on `OperationFor<V>`, `sign()` builds canonical and calls `encodeAsVersion`. The OLD `getTransactionVersionConfig` import goes away.

- [ ] **Step 1: Read current TransactionBuilder**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
sed -n '1,200p' packages/fast-sdk/src/interface/transaction.ts
```

Note: the existing class signature, the existing `add*` methods, the existing `sign()` flow (everything that happens between collecting ops and producing a `TransactionEnvelope`).

- [ ] **Step 2: Write the compile-time test file**

Create `packages/fast-sdk/tests/transaction-builder-types.test.ts`:

```ts
/**
 * Compile-only checks for TransactionBuilder<V> type narrowing.
 * The body of these "tests" never executes — the assertions are entirely
 * at the TypeScript layer via @ts-expect-error.
 *
 * `tsc --noEmit` running over the tests directory verifies the @ts-expect-error
 * comments are satisfied. vitest's runtime sees them as no-ops.
 */
import { describe, it } from 'vitest';
import { TransactionBuilder } from '../src/interface/transaction.ts';
import type { Signer } from '../src/interface/signer.ts';

const signer = {} as Signer;
const nonce = 0n;
const networkId = 'fast:testnet' as const;

describe('TransactionBuilder<V> type narrowing (compile-time)', () => {
  it('Release20260319 builder rejects addEscrow at compile time', () => {
    const builder = new TransactionBuilder<'Release20260319'>({
      version: 'Release20260319',
      signer,
      nonce,
      networkId,
    });
    // @ts-expect-error — addEscrow not available on TransactionBuilder<'Release20260319'>
    builder.addEscrow({ /* anything */ } as never);
  });

  it('Release20260407 builder accepts addEscrow at compile time', () => {
    const builder = new TransactionBuilder<'Release20260407'>({
      version: 'Release20260407',
      signer,
      nonce,
      networkId,
    });
    // No @ts-expect-error — should compile cleanly:
    builder.addEscrow({ /* anything */ } as never);
  });

  it('default version (no version param) defaults to latest and supports Escrow', () => {
    const builder = new TransactionBuilder({ signer, nonce, networkId });
    // No @ts-expect-error — default V = LatestTransactionVersion:
    builder.addEscrow({ /* anything */ } as never);
  });
});
```

- [ ] **Step 3: Migrate `packages/fast-sdk/src/interface/transaction.ts`**

The full migration is too long to inline in this plan step — the implementer needs to make these specific changes:

(a) **Update imports** to drop `getTransactionVersionConfig` and import the new symbols:

```diff
- import { getTransactionVersionConfig, LatestTransactionVersion } from "@fastxyz/schema";
+ import {
+   encodeAsVersion,
+   LatestTransactionVersion,
+   VersionBridges,
+ } from "@fastxyz/schema";
+ import type {
+   LatestTransaction,
+   Operation,
+   OperationFor,
+   TransactionVersion,
+ } from "@fastxyz/schema";
```

(b) **Make the class generic on V** with default to `LatestTransactionVersion`'s type:

```ts
export class TransactionBuilder<V extends TransactionVersion = typeof LatestTransactionVersion> {
  private readonly version: V;
  private readonly collectedOps: OperationFor<V>[] = [];
  // ... other private fields unchanged
}
```

(c) **Constructor takes optional `version` typed as `V`**, defaulting to `LatestTransactionVersion`:

```ts
constructor(opts: {
  version?: V;
  signer: Signer;
  nonce: bigint;
  networkId: NetworkId;
  archival?: boolean;
  feeToken?: TokenId | null;
}) {
  this.version = (opts.version ?? LatestTransactionVersion) as V;
  // ... rest of init
}
```

(d) **Add the `add()` method** as the type-safe primary entry:

```ts
add(op: OperationFor<V>): this {
  const bridge = VersionBridges[this.version];
  if (!bridge.supportedOperations.includes(op.type as never)) {
    throw new IncompatibleOperationError(
      `Operation '${op.type}' is not supported by ${this.version}`,
      {
        version: this.version,
        opType: op.type,
        supported: [...bridge.supportedOperations],
      },
    );
  }
  this.collectedOps.push(op);
  return this;
}
```

(e) **Update existing `addX` convenience methods** to narrow per V where appropriate. For ops supported by ALL versions (TokenTransfer, etc.), keep the simple `(...): this` signature. For version-restricted ops (Escrow), narrow:

```ts
// Existed: addTokenTransfer(p: TokenTransferParams): this
// No change needed — TokenTransfer is in every version's supportedOperations.

// Existed: addEscrow(p: EscrowParams): this
// CHANGE TO:
addEscrow(
  p: EscrowParams,
): OperationFor<V> extends { type: 'Escrow' } ? this : never {
  return this.add({ type: 'Escrow', value: p } as OperationFor<V>) as never;
}
```

Apply the conditional-typing pattern only to ops that don't exist in all versions (today: just Escrow). All other addX methods stay `: this`.

(f) **Rewrite `sign()`** to build canonical and use `encodeAsVersion`:

```ts
async sign(): Promise<TransactionEnvelope> {
  if (this.collectedOps.length === 0) {
    throw new Error("sign() called with no operations");
  }
  const sender = await this.signer.getFastAddress();
  const latest: LatestTransaction = {
    networkId: this.networkId,
    sender,
    nonce: this.nonce,
    timestampNanos: BigInt(Date.now()) * 1_000_000n,
    claims: this.collectedOps as Operation[],
    archival: this.archival,
    feeToken: this.feeToken,
  };
  const versionedEncoded = encodeAsVersion(latest, this.version);
  // CONTINUE with the existing flow that takes the versioned encoded form,
  // BCS-encodes, signs, and returns TransactionEnvelope.
  // The exact integration with the existing BCS-encode-and-sign pipeline
  // depends on what the current sign() does after wrapOperations — read
  // the existing implementation and substitute encodeAsVersion's output
  // wherever the registry-produced shape was previously fed.
}
```

(g) **Delete the old `getTransactionVersionConfig(...).wrapOperations(ops)` call** in sign() — the new `encodeAsVersion` replaces it.

- [ ] **Step 4: Run tests + typecheck**

```bash
cd packages/fast-sdk && pnpm exec tsc --noEmit
cd packages/fast-sdk && pnpm exec vitest run
```

Expected: tsc clean (modulo any pre-existing `@fastxyz/schema` module resolution errors that predate this work — see deferred debt item #12). vitest pass; the new compile-only test file shows as 3 tests passing (because their bodies are empty at runtime — vitest only runs them).

If the existing TransactionBuilder tests fail due to an API change in sign() return shape, examine whether the change is intentional (encodeAsVersion produces a slightly different shape than wrapOperations did) or accidental — adjust accordingly.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-sdk/src/interface/transaction.ts \
         packages/fast-sdk/tests/transaction-builder-types.test.ts
git status -s | grep '^[AM]'  # confirm only these two staged
git commit -m "$(cat <<'EOF'
refactor(fast-sdk): migrate TransactionBuilder to canonical LatestTransaction

TransactionBuilder is now generic on V extends TransactionVersion. The
new add() primary entry narrows on OperationFor<V>; addEscrow narrows
to never on Release20260319 (compile-time exclusion). Runtime defense-
in-depth: add() also runtime-checks against VersionBridges[V].
supportedOperations.

sign() builds a canonical LatestTransaction and calls
encodeAsVersion(latest, this.version), replacing the old
getTransactionVersionConfig + wrapOperations dispatch.

Adds compile-only test file using @ts-expect-error to lock in the
type-narrowing contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Migrate x402-facilitator fast-bcs.ts

**Files:**

- Modify: `packages/x402-facilitator/src/fast-bcs.ts`

**Context:** The decode-side consumer. Uses `getTransactionVersionConfig + extractOperations` today; switches to `LatestFromVersionedTransaction` decode + `latest.claims`. Also uses `Object.keys(TransactionVersionRegistry)` for version enumeration; switches to `SupportedTransactionVersions`.

- [ ] **Step 1: Read current fast-bcs.ts**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
sed -n '1,80p' packages/x402-facilitator/src/fast-bcs.ts
sed -n '280,310p' packages/x402-facilitator/src/fast-bcs.ts
```

Note exactly how `getTransactionVersionConfig`, `TransactionVersionRegistry`, and `extractOperations` are used. The decode site at lines 293-294 takes a BCS-decoded `decoded` (`Record<string, unknown>`) and pulls operations out.

- [ ] **Step 2: Migrate**

Edit `packages/x402-facilitator/src/fast-bcs.ts`:

(a) **Update imports**:

```diff
- import { getTransactionVersionConfig, TransactionVersionRegistry } from '@fastxyz/schema';
+ import {
+   LatestFromVersionedTransaction,
+   SupportedTransactionVersions,
+ } from '@fastxyz/schema';
+ import { Schema } from 'effect';
```

(b) **Replace `KNOWN_VERSIONS`** at line 65:

```diff
- const KNOWN_VERSIONS = Object.keys(TransactionVersionRegistry) as TransactionVersionKey[];
+ const KNOWN_VERSIONS = SupportedTransactionVersions;
```

(c) **Replace the decode site** at lines 293-294:

```diff
- const config = getTransactionVersionConfig(decoded.version);
- const ops = config.extractOperations(decoded as unknown as Record<string, unknown>);
+ const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(decoded);
+ const ops = latest.claims;
```

(IMPLEMENTER NOTE: the `decoded` value's shape feeding into the decode call MUST match what `LatestFromVersionedTransaction.Encoded` expects — i.e., `{ type: 'Release20260319' | 'Release20260407', value: ... }`. If `decoded` from the upstream BCS layout is shaped as `{ Release20260319: {...} }` (raw key-value), it's a TypedVariant-encoded form that may or may not need adjustment. Test the migrated path against an existing facilitator test to verify shape compatibility. If shapes differ, write a small adapter or modify the decode call to accept the actual shape.)

- [ ] **Step 3: Verify build**

```bash
cd packages/x402-facilitator && pnpm exec tsc --noEmit
```

Expected: typecheck clean (modulo pre-existing `@fastxyz/schema` module resolution errors from deferred item #12).

- [ ] **Step 4: Run x402-facilitator tests if any exist that exercise the BCS decode path**

```bash
cd packages/x402-facilitator && pnpm exec vitest run 2>&1 | tail -10
```

Expected: PASS, or pre-existing failures unchanged. If a new failure surfaces specifically around `LatestFromVersionedTransaction` decode, that's the shape-compatibility issue from the IMPLEMENTER NOTE in Step 2 — fix it.

- [ ] **Step 5: Commit**

```bash
git add packages/x402-facilitator/src/fast-bcs.ts
git status -s | grep '^[AM]'
git commit -m "$(cat <<'EOF'
refactor(x402-facilitator): migrate BCS decode to LatestFromVersionedTransaction

Replaces getTransactionVersionConfig + extractOperations with the new
auto-dispatch decoder LatestFromVersionedTransaction. Decoded canonical's
.claims is a flat Operation[] array regardless of which release version
produced the wire bytes.

KNOWN_VERSIONS now sourced from SupportedTransactionVersions instead of
Object.keys(TransactionVersionRegistry).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Delete TransactionVersionRegistry

**Files:**

- Delete: `packages/fast-schema/src/interface/transaction-registry.ts`
- Delete: `packages/fast-schema/tests/unit/interface/transaction-registry.test.ts`

**Context:** Both consumers (Tasks 7 + 8) are now migrated. Final verification + deletion.

- [ ] **Step 1: Verify no remaining consumers**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
grep -rn "TransactionVersionRegistry\|getTransactionVersionConfig" packages/ --include="*.ts" 2>/dev/null | grep -v dist/
```

Expected: only matches inside `packages/fast-schema/src/interface/transaction-registry.ts` and its test file. If anywhere else still references either symbol — STOP. Fix that consumer in a small follow-up commit before proceeding.

- [ ] **Step 2: Delete the files**

```bash
rm packages/fast-schema/src/interface/transaction-registry.ts
rm packages/fast-schema/tests/unit/interface/transaction-registry.test.ts
```

- [ ] **Step 3: Verify nothing references the deleted symbols anymore**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
cd packages/fast-schema && pnpm exec vitest run
cd ../fast-sdk && pnpm exec tsc --noEmit
cd ../x402-facilitator && pnpm exec tsc --noEmit
```

Expected: all green (modulo pre-existing module resolution errors).

- [ ] **Step 4: Commit**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
git add -u packages/fast-schema/src/interface/transaction-registry.ts \
            packages/fast-schema/tests/unit/interface/transaction-registry.test.ts
git status -s | grep '^[D]'  # confirm deletions staged
git commit -m "$(cat <<'EOF'
refactor(fast-schema)!: delete TransactionVersionRegistry

Both consumers (TransactionBuilder, x402-facilitator) migrated to the
canonical LatestTransaction + bridges in earlier commits. The registry
file and its test file are removed.

BREAKING CHANGE: getTransactionVersionConfig and TransactionVersionRegistry
are removed from @fastxyz/schema's public API. Use:
- encodeAsVersion(latest, version) for encode (replaces wrapOperations)
- LatestFromVersionedTransaction decode for extract (replaces extractOperations)
- SupportedTransactionVersions for enumeration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add changeset entry

**Files:**

- Create: `.changeset/canonical-latest-transaction.md`

- [ ] **Step 1: Pick the bump level**

The registry deletion is a public API removal — major bump for `@fastxyz/schema`. The TransactionBuilder change is a breaking API change for `@fastxyz/sdk` (constructor now generic, `add()` method new) — major. The facilitator change uses the new schema API — patch (no public API change of its own).

- [ ] **Step 2: Create the changeset**

Create `.changeset/canonical-latest-transaction.md`:

```markdown
---
"@fastxyz/schema": major
"@fastxyz/sdk": major
"@fastxyz/x402-facilitator": patch
---

Replace TransactionVersionRegistry with canonical LatestTransaction + bidirectional bridges (mirrors Rust's `latest::Transaction` + `From` impls pattern).

### `@fastxyz/schema`

**Breaking:**

- `TransactionVersionRegistry` and `getTransactionVersionConfig` removed.

**Migration:**

```diff
- import { getTransactionVersionConfig } from '@fastxyz/schema';
- const config = getTransactionVersionConfig(version);
- const wire = config.wrapOperations(ops);          // encode
- const ops  = config.extractOperations(decoded);   // decode

+ import { encodeAsVersion, LatestFromVersionedTransaction } from '@fastxyz/schema';
+ import { Schema } from 'effect';
+ const wire   = encodeAsVersion(latest, version);  // encode (throws if op unsupported)
+ const latest = Schema.decodeUnknownSync(LatestFromVersionedTransaction)(decoded);
+ const ops    = latest.claims;                      // decode + canonical view
```

**New exports:**

- `LatestTransaction` schema and `Operation` type — canonical Transaction view
- `LatestFromRelease20260319`, `LatestFromRelease20260407` — per-version bridges
- `LatestFromVersionedTransaction` — auto-dispatch decoder
- `encodeAsVersion(latest, version)` — encoder picking target version explicitly
- `VersionBridges` — typed registry, single source of truth for "what versions exist"
- `OperationRelease20260319`, `OperationRelease20260407` — per-version Operation enum schemas
- `Release20260319SupportedOperations`, `Release20260407SupportedOperations` — typed tag tuples
- `OperationFor<V>`, `SupportedOpTagFor<V>` — type-level helpers

### `@fastxyz/sdk`

**Breaking:**

- `TransactionBuilder` is now generic on `V extends TransactionVersion`. Existing usages without an explicit type parameter still work (defaults to `LatestTransactionVersion`).
- New primary `add(op)` method narrows on `OperationFor<V>` for compile-time per-version operation safety.
- `addEscrow(...)` returns `never` on `TransactionBuilder<'Release20260319'>` — TypeScript prevents the call at compile time. Runtime defense-in-depth via `VersionBridges[V].supportedOperations` check.

### `@fastxyz/x402-facilitator`

- Internal: BCS decode site now uses `LatestFromVersionedTransaction`. No public API change.

```

- [ ] **Step 3: Commit**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
git add .changeset/canonical-latest-transaction.md
git commit -m "chore: changeset for canonical LatestTransaction refactor (major)"
```

---

## Final verification

- [ ] **Run the entire affected test surface**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
cd packages/fast-schema && pnpm exec vitest run && pnpm exec tsc --noEmit
cd ../fast-sdk && pnpm exec vitest run && pnpm exec tsc --noEmit
cd ../x402-facilitator && pnpm exec tsc --noEmit
```

Expected: all green (modulo pre-existing module resolution errors flagged in deferred debt item #12).

- [ ] **Confirm registry is fully gone from the workspace**

```bash
cd /home/yuqing/Documents/Code/fast-sdk
grep -rn "TransactionVersionRegistry\|getTransactionVersionConfig\|wrapOperations\|extractOperations" packages/ --include="*.ts" 2>/dev/null | grep -v dist/
```

Expected: no output. (`wrapOperations`/`extractOperations` were registry methods; if they appear elsewhere, investigate.)

- [ ] **Push branch when ready**

```bash
git push -u origin refactor/canonical-latest-transaction
```

(Open the PR after verifying both Wave 1 and Wave 2 PRs are landing first — this refactor's branch base assumes Wave 2 is in `develop`.)

---

## Pass criteria for the cleanup as a whole

1. All new tests pass; existing schema/sdk tests don't regress.
2. `tsc --noEmit` clean across `fast-schema`, `fast-sdk`, `x402-facilitator`.
3. `transaction-registry.ts` and its test file deleted; no references remain in the workspace.
4. Runtime behavior of `TransactionBuilder.sign()` and facilitator BCS decode is unchanged for existing happy-path scenarios.
5. New compile-time check: `TransactionBuilder<'Release20260319'>.addEscrow(...)` is a TS error (verified via `@ts-expect-error` test file).
6. New runtime check: passing an Escrow op to a Release20260319 builder via `add()` (with type cast) throws `IncompatibleOperationError`.
7. Round-trip: build → sign → BCS-decode → `LatestFromVersionedTransaction.decode` produces canonical with same ops.
