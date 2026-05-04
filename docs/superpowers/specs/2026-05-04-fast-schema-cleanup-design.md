# fast-schema cleanup — palette discipline restoration

**Status:** approved, pending implementation
**Author:** Yuqing Zhai
**Date:** 2026-05-04

## Background

`@fastxyz/schema` accumulated three pieces of palette debt in PR #76 (Apr 2026, "REST API migration + Release20260407"):

1. **`*FromRest` widened with `string`-form bigint tolerance** for the wallet extension's Chrome-port boundary, where `JSON.stringify` can't carry `BigInt` natively. This made `NonceFromRest` / `QuorumFromRest` accept inputs the proxy never emits, lying about wire fidelity.
2. **`*FromRpc` survives REST migration only because the AllSet cross-sign service hasn't migrated.** Its purpose is undocumented — looks like dead code on first read.
3. **`*FromInput` is inconsistently lenient** — byte-array fields accept `0x` prefix via `Strip0xHex`, but numeric hex fields (`AmountFromInput`, `BalanceFromInput`) reject it.

Plus two latent bugs:

1. `ProxySubmitTransactionResult` declares unit variants as `null` but Rust serializes them as `{Name: []}` (tuple-with-no-fields), so encode produces a form Rust would reject. Currently works only because this enum is response-only.
2. `JsonRpcError` and `ProxyErrorData.RpcError` were left behind by the REST migration with no production consumer.

This spec restores a coherent four-palette discipline, fixes the latent bugs, and removes the orphans.

## Goals

- Each palette names exactly what it does, and accepts only what its name claims.
- No production consumer breaks.
- Cross-repo coordination (extension repo) is explicit, sequenced, and lockstep.
- Outcome is testable per-item, with negative tests for the wire-fidelity contract.

## Non-goals

- Replacing `TransactionVersionRegistry` with a canonical `LatestTransaction` type (separate, larger refactor — debt list item #5, deferred).
- Adding CI typecheck gating (debt list item #7, deferred to a future CI review pass).
- Touching the BCS palette beyond what's necessary for #4.
- Changing the AllSet cross-sign protocol (out of repo control).

## Architecture: four-palette discipline

```
┌─────────────────────────────────────────────────────────────────────┐
│ Palette        │ Direction       │ Stance                           │
├─────────────────────────────────────────────────────────────────────┤
│ RestPalette    │ ↓ decode REST   │ Wire-faithful. Exactly what the  │
│                │ ↑ encode REST   │ proxy emits. NO defensive        │
│                │                 │ widening.                        │
├─────────────────────────────────────────────────────────────────────┤
│ TransportPaltt │ ↓ decode after  │ REST + tolerance for bigint-typed│
│                │   JSON-bridge   │ primitives to accept their post- │
│                │ ↑ encode (rare) │ String(bigint) form. NO other    │
│                │                 │ widening.                        │
├─────────────────────────────────────────────────────────────────────┤
│ InputPalette   │ ↑ user-supplied │ Lenient. Accepts every reasonable│
│                │   builder input │ user format on every primitive.  │
├─────────────────────────────────────────────────────────────────────┤
│ RpcPalette     │ ↑ encode for    │ Wire-faithful for legacy JSON-RPC│
│                │   cross-sign    │ Lowercase hex only, no 0x prefix,│
│                │ ↓ decode (test  │ sign only on signed types.       │
│                │   fixtures)     │                                  │
└─────────────────────────────────────────────────────────────────────┘
```

Consumers pick the palette that matches their direction. The extension's port-bridge encode/decode boundary moves from `*FromRest` to `*FromTransport`. Everywhere else stays where it is.

## Per-item changes

### #1 — REST tighten + new `TransportPalette`

**`packages/fast-schema/src/util/numeric.ts`** — add a strict counterpart to the widened helpers:

```ts
export const BigIntFromNumberOrSelf = Schema.transform(
  Schema.Union(Schema.Number, Schema.BigIntFromSelf),
  Schema.BigIntFromSelf,
  { strict: true,
    decode: (n) => (typeof n === 'bigint' ? n : BigInt(n)),
    encode: (n) => n });

export const UintBigIntFromNumberOrSelf = <N extends number>(bits: N) =>
  Schema.compose(BigIntFromNumberOrSelf, UintBigInt(bits));
export const IntBigIntFromNumberOrSelf = <N extends number>(bits: N) =>
  Schema.compose(BigIntFromNumberOrSelf, IntBigInt(bits));
```

**`packages/fast-schema/src/util/instances.ts`** — derived: `Uint64FromNumberOrSelf`, `Uint256FromNumberOrSelf`, `Int320FromNumberOrSelf`. Existing `*FromNumberOrStringOrSelf` helpers stay (used by Input and Transport).

**`packages/fast-schema/src/base/rest.ts`** — switch the bigint primitives:

```ts
export const NonceFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Quorum'));
// (Address, Token, Signature, ClaimData, etc. unchanged — already strict)
```

Top-of-file comment: "Wire-faithful. Use TransportPalette for any path that goes through a JSON-string transport boundary."

**`packages/fast-schema/src/base/transport.ts`** — new file. Mirrors `base/rest.ts` but uses the loose helpers for bigint primitives, identical for everything else:

```ts
export const NonceFromTransport      = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromTransport     = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Quorum'));
export const NetworkIdFromTransport  = NetworkId;
export const AddressFromTransport    = AddressFromRest;
export const SignatureFromTransport  = SignatureFromRest;
export const TokenIdFromTransport    = TokenIdFromRest;
export const StateKeyFromTransport   = StateKeyFromRest;
export const StateFromTransport      = StateFromRest;
export const ClaimDataFromTransport  = ClaimDataFromRest;
export const UserDataFromTransport   = UserDataFromRest;
export const AmountFromTransport     = AmountFromRest;   // already string-typed
export const BalanceFromTransport    = BalanceFromRest;  // already string-typed
```

**`packages/fast-schema/src/palette/definition.ts`** — add `TransportPalette`:

```ts
export const TransportPalette = {
  Amount: AmountFromTransport,
  Balance: BalanceFromTransport,
  Nonce: NonceFromTransport,
  Quorum: QuorumFromTransport,
  /* …rest identical to RestPalette, importing from base/transport.ts… */
  BigInt: BigIntFromNumberOrStringOrSelf,
} satisfies BasePalette;
```

**`packages/fast-schema/src/palette/transport.ts`** — new file. Mirrors `palette/rest.ts` structure, runs the same factories with `TransportPalette`. Exports the schemas the extension actually needs:

```ts
const p = TransportPalette;
export const TransactionEnvelopeFromTransport     = makeTransactionEnvelope(p);
export const ValidatedTransactionFromTransport    = makeValidatedTransaction(p);
export const TransactionCertificateFromTransport  = makeTransactionCertificate(p);
export const AccountInfoResponseFromTransport     = makeAccountInfoResponse(p);
export const TokenInfoResponseFromTransport       = makeTokenInfoResponse(p);
```

**`packages/fast-schema/src/base/index.ts`** and **`packages/fast-schema/src/palette/index.ts`** — re-export new symbols.

### #2 — Document `*FromRpc` rationale

**`packages/fast-schema/src/base/rpc.ts`** — top-of-file comment (~10 lines):

> This palette describes the legacy JSON-RPC wire format. It survives the REST migration (PR #76, Apr 2026) solely because `allset-sdk/src/bridge.ts` encodes `TransactionCertificate` to it for the AllSet cross-sign service — a JSON-RPC service that has not migrated. Encode-only in production; decode is exercised only by test fixtures. Do not extend this palette without coordinating with the cross-sign service owners.

### #3 — Delete `JsonRpcError` / `ProxyErrorData.RpcError` orphans

Verification step (not a change yet): final grep across all workspace packages and the extension repo to confirm zero non-test consumers. If clean:

- **`packages/fast-schema/src/errors/fastset.ts`** — delete `JsonRpcError` const, `ProxyErrorData.RpcError` variant, `JsonRpcError` re-export.
- **`packages/fast-schema/src/errors/index.ts`** — drop `JsonRpcError` export.
- **`packages/fast-schema/tests/unit/errors.test.ts`** — delete `describe('JsonRpcError', …)` block and `RpcError` cases inside `describe('ProxyErrorData', …)`.

### #4 — `ProxySubmitTransactionResult` unit-variant encoding

**`packages/fast-schema/src/composite/response.ts`** (lines 134–138):

```ts
TypedVariant({
  Success: makeTransactionCertificate(p),
  IncompleteVerifierSigs: null,
  IncompleteMultiSig: null,
}, { unitEncoding: 'bcs' })   // ← was implicit 'serde'
```

Encode now emits `{IncompleteVerifierSigs: []}` (matching Rust's tuple-variant wire form) instead of `"IncompleteVerifierSigs"` (which Rust would reject). Decode behavior unchanged — both forms continue to be accepted.

### #8 — `HexLowerBigInt` family for RPC

**`packages/fast-schema/src/util/numeric.ts`** — strict-lowercase counterparts:

```ts
export const HexLowerBigInt = Schema.transform(Schema.String, Schema.BigIntFromSelf, {
  strict: true,
  decode: (s) => {
    const sign = s[0] === '-' ? -1n : 1n;
    const digits = s[0] === '-' ? s.slice(1) : s;
    if (digits.length === 0 || !/^[0-9a-f]+$/.test(digits)) {
      throw new Error(`Invalid lowercase hex string: "${s}"`);
    }
    return sign * BigInt(`0x${digits}`);
  },
  encode: (n) => n.toString(16),
});

export const HexLowerUintBigInt = <N extends number>(bits: N) =>
  Schema.compose(HexLowerBigInt, UintBigInt(bits));
export const HexLowerIntBigInt = <N extends number>(bits: N) =>
  Schema.compose(HexLowerBigInt, IntBigInt(bits));
```

**`packages/fast-schema/src/util/instances.ts`** — `HexLowerUint256`, `HexLowerInt320`.

**`packages/fast-schema/src/base/rpc.ts`**:

```ts
export const AmountFromRpc  = HexLowerUint256.pipe(Schema.brand('Amount'));
export const BalanceFromRpc = HexLowerInt320.pipe(Schema.brand('Balance'));
```

Existing `HexBigInt` / `HexNumber` / `HexUint256` / `HexInt320` stay (still consumed by Input's hex branch).

### #9 — Input numeric hex accepts `0x`

**`packages/fast-schema/src/base/input.ts`** — compose `Strip0xHex` in front of the hex branch:

```ts
export const AmountFromInput = Schema.Union(
  Uint256FromNumberOrStringOrSelf,
  Schema.compose(Strip0xHex, HexUint256),
  DecimalUint256,
).pipe(Schema.brand("Amount"));

export const BalanceFromInput = Schema.Union(
  Int320FromNumberOrStringOrSelf,
  Schema.compose(Strip0xHex, HexInt320),
  DecimalInt320,
).pipe(Schema.brand("Balance"));
```

`Strip0xHex` already exists; this is two one-line edits.

## Cross-repo migration (item #1 only)

### What breaks if extension isn't migrated

After tightening, the extension's existing receiver decode would fail at runtime: `Schema.decodeUnknown(TransactionCertificateFromRest)(received)` where `received.next_nonce` is the string `"9999999999999999999"`. `*FromRest` no longer accepts string for Nonce → `ParseError` on decode.

So the schema change is **breaking for the extension** if shipped alone. The extension import swap is mandatory before any user-facing extension release built against the new schema.

### Migration steps

Three changes in `fastset-wallet-browser-extension/src/core/api/txn.ts`:

```diff
- import { TransactionCertificateFromRest, OperationInput } from "@fastxyz/schema";
+ import { TransactionCertificateFromTransport, OperationInput } from "@fastxyz/schema";

- export type EncodedTransactionCertificate =
-   Schema.Schema.Encoded<typeof TransactionCertificateFromRest>;
+ export type EncodedTransactionCertificate =
+   Schema.Schema.Encoded<typeof TransactionCertificateFromTransport>;

  const encodeForPort = (cert: TransactionCertificate): EncodedTransactionCertificate => {
-   const encoded = Schema.encodeSync(TransactionCertificateFromRest)(cert);
+   const encoded = Schema.encodeSync(TransactionCertificateFromTransport)(cert);
    return JSON.parse(JSON.stringify(encoded, (_, v) => typeof v === 'bigint' ? String(v) : v));
  };
```

Plus the symmetric receiver-side decode call in `scripts/content/dapp-api.ts` (find via grep — confirmed by the existing comment there pointing at `TransactionCertificateFromRest`).

### Release sequencing

```
                t=0          t=+a few days        t=+release
                │                  │                    │
fast-schema     ●─ PR merge ──────►│                    │
                │  (publish        │                    │
                │   N+1 to npm)    │                    │
                │                  │                    │
extension       │                  ●─ PR merge ────────►●─ release
                │                  │  (bump @fastxyz/   │  to users
                │                  │   schema to N+1,   │
                │                  │   swap imports)    │
```

Critical sequencing rules:

1. Schema PR merges first; `@fastxyz/schema` publishes via the existing changeset workflow.
2. Extension PR opens immediately after with the schema-version bump and import swap in the same commit.
3. Extension does not release to users until extension PR is merged.
4. No interim user-facing extension release between schema-PR-merge and extension-PR-merge.

### Risk

A contributor running `pnpm up @fastxyz/schema` in the extension repo without doing the import swap: TypeScript compile passes (`*FromRest` still exported), but runtime `Schema.decodeUnknown` throws at the cross-port boundary.

**Mitigation:** add a round-trip integration test in the extension repo (encode → JSON.stringify(bigint→String) → JSON.parse → decode with a Nonce > 2^53). If `*FromRest` is used instead of `*FromTransport`, the test fails. This test ships with the extension PR and locks in the discipline.

### What does NOT change in the extension

- Operation builder using `OperationInput` — Input palette, untouched.
- BCS hashing path using `VersionedTransactionFromBcs` — BCS palette, untouched.
- All type-only imports (`TransactionCertificate`, `OperationInputParams`, `TokenMetadata`, `NetworkId`) — derived domain types, shape unchanged.

## Testing strategy

### New tests

| Item | Test |
|---|---|
| #1 | TransportPalette decode accepts string-form Nonce/Quorum where RestPalette rejects them |
| #1 | RestPalette decode rejects string-form Nonce/Quorum (negative test, regression guard) |
| #1 | (extension repo) encode → JSON-mangle → decode round-trip with Nonce > 2^53 succeeds via `*FromTransport`, fails via `*FromRest` |
| #4 | Encode of `{ type: 'IncompleteVerifierSigs' }` produces `{IncompleteVerifierSigs: []}`, not `"IncompleteVerifierSigs"` |
| #4 | Round-trip: encode → decode is identity for all three `ProxySubmitTransactionResult` variants |
| #8 | `HexLowerBigInt` rejects `"FF"`, accepts `"ff"` |
| #8 | `AmountFromRpc` decode rejects `"-1"` at hex layer; `BalanceFromRpc` accepts `"-ff"` |
| #9 | `AmountFromInput.decode("0xff")`, `("ff")`, `(255n)` all succeed |

Tests live alongside existing `tests/unit/{base,composite,util}/` files, one-file-per-source convention. Extension round-trip test: new `fastset-wallet-browser-extension/src/core/api/__tests__/txn-port-roundtrip.test.ts`.

### No new tests for

- #2 (doc-only)
- #3 (deletion — existing positive tests for the deleted variants get deleted with them)

### Verification commands

**Wave 1 (in fast-sdk):**

```
pnpm --filter @fastxyz/schema test
pnpm --filter @fastxyz/schema typecheck
pnpm --filter @fastxyz/sdk test
pnpm --filter @fastxyz/x402-facilitator typecheck
pnpm --filter @fastxyz/allset-sdk typecheck
```

**Wave 2 schema PR (in fast-sdk):**

All Wave 1 commands, plus: in a worktree of the extension repo with `@fastxyz/schema` linked, run extension's `pnpm typecheck` and the new round-trip test — must pass.

**Wave 2 extension PR (in fastset-wallet-browser-extension):**

```
pnpm typecheck
pnpm test     # incl. new txn-port-roundtrip.test
```

Plus manual smoke: build extension, install in browser, exercise a `TokenTransfer` end-to-end.

### Pass criteria

1. All schema-package tests pass.
2. `tsc --noEmit` clean across `fast-schema`, `fast-sdk`, `allset-sdk`, `x402-facilitator`.
3. Extension round-trip test passes against the new schema, **fails** if reverted to `*FromRest` imports.
4. Manual extension smoke test: send a `TokenTransfer` end-to-end, certificate makes it back through the port unmolested.

## Sequencing — two waves

### Wave 1 — schema-internal cleanup

Single PR in `fast-sdk` containing items #2, #3, #4, #8, #9. All schema-internal, no cross-repo dependency. Should land in a single review cycle.

### Wave 2 — REST/Transport split + extension migration

Two coordinated PRs:

- **fast-sdk PR**: item #1 only. Includes schema-version bump (changeset entry).
- **fastset-wallet-browser-extension PR**: schema-version bump in `package.json` + import swap in `txn.ts` and `dapp-api.ts` + new round-trip test.

Schema PR merges first → npm publish happens → extension PR bumps to the new version and merges → extension release.

Wave 2 begins **after** Wave 1 has merged and published, so the schema-version bumps don't collide.

## Out of scope (deferred)

- **#5** — Replace `TransactionVersionRegistry` with canonical `LatestTransaction` + `Schema.transformOrFail` upcasts. Larger structural refactor; warrants its own design pass.
- **#7** — Add CI typecheck gate. Flagged for a future CI review pass.
