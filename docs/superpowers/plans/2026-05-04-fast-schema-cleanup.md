# fast-schema palette discipline cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore four-palette discipline (REST / Transport / Input / Rpc) in `@fastxyz/schema`; fix two latent encoding bugs; remove orphaned RPC error types.

**Architecture:** Two waves of PRs. **Wave 1** — schema-internal cleanup (items #2 doc, #3 delete, #4 unit-variant fix, #8 HexLowerBigInt, #9 Input numeric hex with 0x). All on branch `cleanup/schema-palette-discipline`. **Wave 2** — REST tighten + new TransportPalette (item #1), coordinated with the extension import swap. Schema PR merges and publishes to npm before extension PR opens.

**Tech Stack:** TypeScript, Effect Schema, vitest, pnpm workspace, changesets.

**Spec:** `docs/superpowers/specs/2026-05-04-fast-schema-cleanup-design.md`

**Test command:** `cd packages/fast-schema && pnpm exec vitest run <path>` (the package has no `test` npm script; vitest is invoked directly).

---

## Wave 1 — schema-internal cleanup

All Wave 1 tasks land on the existing `cleanup/schema-palette-discipline` branch in this repo. No cross-repo dependency.

### Task 1: Fix `ProxySubmitTransactionResult` unit-variant encoding (item #4)

**Files:**

- Modify: `packages/fast-schema/src/composite/response.ts:134-138`
- Test: `packages/fast-schema/tests/unit/composite/response.test.ts` (create)

**Context:** Rust serializes the empty tuple variants `IncompleteVerifierSigs()` and `IncompleteMultiSig()` as `{Name: []}`. The current SDK declares them as `null` unit variants in `TypedVariant`, which encodes back to bare strings `"IncompleteVerifierSigs"` — a form Rust would reject. This works today only because the enum is response-only. Switching to `unitEncoding: 'bcs'` makes encode emit the correct `{Name: []}` shape; decode behavior is unchanged (the lenient decoder accepts both forms).

- [ ] **Step 1: Write the failing tests**

Create `packages/fast-schema/tests/unit/composite/response.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { ProxySubmitTransactionResultFromRest } from '../../../src/palette/rest.ts';

describe('ProxySubmitTransactionResult unit variant encoding', () => {
  it('encodes IncompleteVerifierSigs as { Key: [] } not bare string', () => {
    const encoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)({
      type: 'IncompleteVerifierSigs',
    });
    expect(encoded).toEqual({ IncompleteVerifierSigs: [] });
  });

  it('encodes IncompleteMultiSig as { Key: [] } not bare string', () => {
    const encoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)({
      type: 'IncompleteMultiSig',
    });
    expect(encoded).toEqual({ IncompleteMultiSig: [] });
  });

  it('round-trips IncompleteVerifierSigs through { Key: [] } form', () => {
    const decoded = Schema.decodeUnknownSync(ProxySubmitTransactionResultFromRest)({
      IncompleteVerifierSigs: [],
    });
    expect(decoded).toEqual({ type: 'IncompleteVerifierSigs' });
    const reencoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)(decoded);
    expect(reencoded).toEqual({ IncompleteVerifierSigs: [] });
  });

  it('round-trips IncompleteMultiSig through { Key: [] } form', () => {
    const decoded = Schema.decodeUnknownSync(ProxySubmitTransactionResultFromRest)({
      IncompleteMultiSig: [],
    });
    expect(decoded).toEqual({ type: 'IncompleteMultiSig' });
    const reencoded = Schema.encodeSync(ProxySubmitTransactionResultFromRest)(decoded);
    expect(reencoded).toEqual({ IncompleteMultiSig: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/response.test.ts
```

Expected: FAIL with "expected { IncompleteVerifierSigs: [] } to equal 'IncompleteVerifierSigs'" (current encode returns the bare string).

- [ ] **Step 3: Apply the fix**

Edit `packages/fast-schema/src/composite/response.ts` lines 134-138 — add the `unitEncoding: 'bcs'` option to the `TypedVariant` call inside `makeProxySubmitTransactionResult`:

```ts
TypedVariant({
  Success: makeTransactionCertificate(p),
  IncompleteVerifierSigs: null,
  IncompleteMultiSig: null,
}, { unitEncoding: 'bcs' });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/composite/response.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Verify nothing else broke**

```bash
cd packages/fast-schema && pnpm exec vitest run
```

Expected: all schema tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/fast-schema/src/composite/response.ts packages/fast-schema/tests/unit/composite/response.test.ts
git commit -m "$(cat <<'EOF'
fix(fast-schema): encode ProxySubmitTransactionResult unit variants as { Key: [] }

Rust serializes the empty tuple variants IncompleteVerifierSigs() and
IncompleteMultiSig() as {Name: []}. The schema's TypedVariant in serde
mode encoded them as bare strings, which Rust would reject. Switch to
unitEncoding: 'bcs' so encode emits the correct shape. Decode remains
backward-compatible (both forms continue to decode).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `HexLowerBigInt` family (item #8, part 1 — primitives)

**Files:**

- Modify: `packages/fast-schema/src/util/numeric.ts`
- Modify: `packages/fast-schema/tests/unit/util/numeric.test.ts`

**Context:** The RPC wire (cross-sign) emits hex via Rust's `to_str_radix(16)` — lowercase, no `0x` prefix, sign only on signed types. Existing `HexBigInt` accepts uppercase too. We add a strict `HexLowerBigInt` for the RPC palette. Existing `HexBigInt` stays for the Input palette where uppercase is welcome.

- [ ] **Step 1: Write the failing tests**

Append to `packages/fast-schema/tests/unit/util/numeric.test.ts`:

```ts
import { HexLowerBigInt, HexLowerUintBigInt, HexLowerIntBigInt } from '../../../src/util/numeric.ts';

describe('HexLowerBigInt', () => {
  it('decodes lowercase hex', () => {
    expect(decodeSync(HexLowerBigInt, 'ff')).toBe(255n);
    expect(decodeSync(HexLowerBigInt, 'deadbeef')).toBe(0xdeadbeefn);
  });

  it('rejects uppercase hex', () => {
    expect(() => decodeSync(HexLowerBigInt, 'FF')).toThrow(/lowercase hex/);
    expect(() => decodeSync(HexLowerBigInt, 'DeadBeef')).toThrow(/lowercase hex/);
  });

  it('rejects 0x prefix', () => {
    expect(() => decodeSync(HexLowerBigInt, '0xff')).toThrow(/lowercase hex/);
  });

  it('rejects empty string', () => {
    expect(() => decodeSync(HexLowerBigInt, '')).toThrow(/lowercase hex/);
  });

  it('decodes negative lowercase hex', () => {
    expect(decodeSync(HexLowerBigInt, '-1f4')).toBe(-500n);
  });

  it('encodes bigint as lowercase hex', () => {
    expect(encodeSync(HexLowerBigInt, 0xabcdn)).toBe('abcd');
    expect(encodeSync(HexLowerBigInt, -500n)).toBe('-1f4');
  });

  it('round-trips', () => {
    const decoded = decodeSync(HexLowerBigInt, 'deadbeef');
    expect(encodeSync(HexLowerBigInt, decoded)).toBe('deadbeef');
  });
});

describe('HexLowerUintBigInt', () => {
  it('rejects negative input', () => {
    const HexLowerUint64 = HexLowerUintBigInt(64);
    expect(() => decodeSync(HexLowerUint64, '-1')).toThrow();
  });

  it('accepts in-range positive', () => {
    const HexLowerUint64 = HexLowerUintBigInt(64);
    expect(decodeSync(HexLowerUint64, 'ff')).toBe(255n);
  });
});

describe('HexLowerIntBigInt', () => {
  it('accepts negative input', () => {
    const HexLowerInt64 = HexLowerIntBigInt(64);
    expect(decodeSync(HexLowerInt64, '-ff')).toBe(-255n);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/util/numeric.test.ts
```

Expected: import failures — `HexLowerBigInt`, `HexLowerUintBigInt`, `HexLowerIntBigInt` not exported.

- [ ] **Step 3: Add the strict primitives**

Append to `packages/fast-schema/src/util/numeric.ts`:

```ts
/**
 * Strict lowercase hex variant of `HexBigInt`.
 *
 * Enforces `^-?[0-9a-f]+$` — the exact form emitted by Rust's `to_str_radix(16)`
 * over the legacy JSON-RPC wire. Use in `RpcPalette` where wire-fidelity matters.
 * For tolerant user-input parsing, use `HexBigInt`.
 */
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

/** Strict-lowercase hex string to branded unsigned bigint. */
export const HexLowerUintBigInt = <N extends number>(bits: N) =>
  Schema.compose(HexLowerBigInt, UintBigInt(bits));

/** Strict-lowercase hex string to branded signed bigint. */
export const HexLowerIntBigInt = <N extends number>(bits: N) =>
  Schema.compose(HexLowerBigInt, IntBigInt(bits));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/util/numeric.test.ts
```

Expected: PASS (all new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/fast-schema/src/util/numeric.ts packages/fast-schema/tests/unit/util/numeric.test.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): add HexLowerBigInt strict-lowercase hex primitive

Adds HexLowerBigInt + HexLowerUintBigInt + HexLowerIntBigInt for use in
the RPC palette. Enforces ^-?[0-9a-f]+$ — the exact form emitted by
Rust's to_str_radix(16). HexBigInt itself is unchanged (still used by
the lenient Input palette).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `HexLowerUint256` / `HexLowerInt320` instances (item #8, part 2)

**Files:**

- Modify: `packages/fast-schema/src/util/instances.ts`

- [ ] **Step 1: Add the instances**

Edit `packages/fast-schema/src/util/instances.ts`. Add to the imports:

```ts
import {
  // ...existing imports...
  HexLowerIntBigInt,
  HexLowerUintBigInt,
} from './numeric.ts';
```

Append after the existing `HexInt320` definition:

```ts
/** Strict-lowercase hex string to branded Uint256 (RPC wire form). */
export const HexLowerUint256 = HexLowerUintBigInt(256);

/** Strict-lowercase hex string to branded Int320 (RPC wire form). */
export const HexLowerInt320 = HexLowerIntBigInt(320);
```

- [ ] **Step 2: Re-export from `util/index.ts`**

Edit `packages/fast-schema/src/util/index.ts`. Add to the existing instance re-exports:

```ts
export {
  // ...existing...
  HexLowerInt320,
  HexLowerUint256,
} from './instances.ts';

export {
  // ...existing...
  HexLowerBigInt,
  HexLowerIntBigInt,
  HexLowerUintBigInt,
} from './numeric.ts';
```

- [ ] **Step 3: Verify build**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all schema tests**

```bash
cd packages/fast-schema && pnpm exec vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-schema/src/util/instances.ts packages/fast-schema/src/util/index.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): export HexLowerUint256 / HexLowerInt320 instances

Sized strict-lowercase hex instances for use in RpcPalette's
AmountFromRpc and BalanceFromRpc. Re-exported from util/index.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Switch `*FromRpc` to use the strict family (item #8, part 3)

**Files:**

- Modify: `packages/fast-schema/src/base/rpc.ts`
- Test: `packages/fast-schema/tests/unit/base/rpc.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `packages/fast-schema/tests/unit/base/rpc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AmountFromRpc, BalanceFromRpc } from '../../../src/base/rpc.ts';
import { decodeSync, encodeSync } from '../helpers.ts';

describe('AmountFromRpc (RPC wire form: lowercase hex, no 0x, no sign)', () => {
  it('decodes lowercase hex', () => {
    expect(decodeSync(AmountFromRpc, 'ff')).toBe(255n);
    expect(decodeSync(AmountFromRpc, 'deadbeef')).toBe(0xdeadbeefn);
  });

  it('rejects uppercase hex', () => {
    expect(() => decodeSync(AmountFromRpc, 'FF')).toThrow();
  });

  it('rejects 0x prefix', () => {
    expect(() => decodeSync(AmountFromRpc, '0xff')).toThrow();
  });

  it('rejects negative input (Amount is unsigned)', () => {
    expect(() => decodeSync(AmountFromRpc, '-1')).toThrow();
  });

  it('encodes back to lowercase hex', () => {
    const decoded = decodeSync(AmountFromRpc, 'abcd');
    expect(encodeSync(AmountFromRpc, decoded)).toBe('abcd');
  });
});

describe('BalanceFromRpc (RPC wire form: lowercase hex, no 0x, signed allowed)', () => {
  it('decodes lowercase positive hex', () => {
    expect(decodeSync(BalanceFromRpc, 'ff')).toBe(255n);
  });

  it('decodes lowercase negative hex', () => {
    expect(decodeSync(BalanceFromRpc, '-ff')).toBe(-255n);
  });

  it('rejects uppercase hex', () => {
    expect(() => decodeSync(BalanceFromRpc, 'FF')).toThrow();
  });

  it('round-trips negative', () => {
    const decoded = decodeSync(BalanceFromRpc, '-1f4');
    expect(encodeSync(BalanceFromRpc, decoded)).toBe('-1f4');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/base/rpc.test.ts
```

Expected: tests for "rejects uppercase" and "rejects 0x" fail (current `HexBigInt` accepts both).

- [ ] **Step 3: Switch the imports + types**

Edit `packages/fast-schema/src/base/rpc.ts`. Replace the import line for hex types:

```ts
import {
  HexLowerInt320,
  HexLowerUint256,
} from '../util/index.ts';
```

(Remove the `HexInt320`, `HexUint256` imports if no longer used in this file.)

Switch the brand definitions:

```ts
export const AmountFromRpc  = HexLowerUint256.pipe(Schema.brand('Amount'));
export const BalanceFromRpc = HexLowerInt320.pipe(Schema.brand('Balance'));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/base/rpc.test.ts
```

Expected: PASS (all 9 tests).

- [ ] **Step 5: Verify allset-sdk tests still pass (cross-sign uses RPC encode path)**

```bash
cd packages/allset-sdk && pnpm exec vitest run 2>&1 | tail -10
```

Expected: PASS — encoding always produces lowercase, so the strict regex never trips. If a test mock fixture in `tests/sdk.test.ts` happened to use uppercase hex literally, update it to lowercase.

- [ ] **Step 6: Commit**

```bash
git add packages/fast-schema/src/base/rpc.ts packages/fast-schema/tests/unit/base/rpc.test.ts
git commit -m "$(cat <<'EOF'
refactor(fast-schema): tighten *FromRpc to wire-faithful lowercase hex

AmountFromRpc and BalanceFromRpc now compose HexLowerUint256/HexLowerInt320,
matching exactly what Rust's to_str_radix(16) emits over the legacy
JSON-RPC wire (cross-sign path). Encode is unchanged (already lowercase).
Decode now rejects uppercase, 0x prefix, and (for Amount) negative — all
forms the wire never emits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Loosen Input numeric hex to accept `0x` prefix (item #9)

**Files:**

- Modify: `packages/fast-schema/src/base/input.ts`
- Test: `packages/fast-schema/tests/unit/base/input.test.ts` (create)

**Context:** Input byte-array fields (TokenId, StateKey, etc.) already accept `0x` via `Strip0xHex`. Numeric hex fields (Amount, Balance) currently don't — inconsistent. Compose `Strip0xHex` in front of the hex branch to make Input uniformly tolerant.

- [ ] **Step 1: Write the failing tests**

Create `packages/fast-schema/tests/unit/base/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AmountFromInput, BalanceFromInput } from '../../../src/base/input.ts';
import { decodeSync } from '../helpers.ts';

describe('AmountFromInput accepts every reasonable user format', () => {
  it('accepts bare lowercase hex', () => {
    expect(decodeSync(AmountFromInput, 'ff')).toBe(255n);
  });

  it('accepts bare uppercase hex', () => {
    expect(decodeSync(AmountFromInput, 'FF')).toBe(255n);
  });

  it('accepts 0x-prefixed lowercase hex', () => {
    expect(decodeSync(AmountFromInput, '0xff')).toBe(255n);
  });

  it('accepts 0x-prefixed uppercase hex', () => {
    expect(decodeSync(AmountFromInput, '0xFF')).toBe(255n);
  });

  it('accepts 0X-prefixed hex', () => {
    expect(decodeSync(AmountFromInput, '0Xff')).toBe(255n);
  });

  it('accepts decimal string', () => {
    expect(decodeSync(AmountFromInput, '255')).toBe(255n);
  });

  it('accepts bigint', () => {
    expect(decodeSync(AmountFromInput, 255n)).toBe(255n);
  });

  it('accepts number', () => {
    expect(decodeSync(AmountFromInput, 255)).toBe(255n);
  });
});

describe('BalanceFromInput accepts 0x-prefixed hex', () => {
  it('accepts 0x-prefixed positive', () => {
    expect(decodeSync(BalanceFromInput, '0xff')).toBe(255n);
  });

  it('accepts decimal negative', () => {
    expect(decodeSync(BalanceFromInput, '-255')).toBe(-255n);
  });
});
```

- [ ] **Step 2: Run tests to verify the 0x-prefixed cases fail**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/base/input.test.ts
```

Expected: the four `0x`/`0X` tests fail; bare hex / decimal / number / bigint cases pass.

- [ ] **Step 3a: Re-export `Strip0xHex` from `util/index.ts`**

`Strip0xHex` exists in `util/array.ts` but isn't re-exported. Add it to the `array.ts` re-export block in `packages/fast-schema/src/util/index.ts`:

```ts
export {
  FixedUint8Array,
  FixedUint8ArrayFromHex,
  FixedUint8ArrayFromHexOptional0x,
  FixedUint8ArrayFromNumberArray,
  Strip0xHex,                         // ← add this
  Uint8ArrayFromBase64,
  Uint8ArrayFromBech32m,
  Uint8ArrayFromHex,
  Uint8ArrayFromHexOptional0x,
  Uint8ArrayFromNumberArray,
} from './array.ts';
```

(Note: also add `FixedUint8ArrayFromHexOptional0x` if it's missing from the re-export — verify by grep first.)

- [ ] **Step 3b: Compose `Strip0xHex` in front of the hex branches**

Edit `packages/fast-schema/src/base/input.ts`. Add `Strip0xHex` to the imports:

```ts
import {
  // ...existing imports...
  Strip0xHex,
} from "../util/index.ts";
```

Replace `AmountFromInput` and `BalanceFromInput`:

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

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/base/input.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Run full schema suite + downstream typechecks**

```bash
cd packages/fast-schema && pnpm exec vitest run
cd ../fast-sdk && pnpm exec tsc --noEmit
cd ../x402-facilitator && pnpm exec tsc --noEmit
cd ../allset-sdk && pnpm exec tsc --noEmit
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/fast-schema/src/base/input.ts packages/fast-schema/tests/unit/base/input.test.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): AmountFromInput and BalanceFromInput accept 0x-prefixed hex

The Input palette is meant to tolerate every reasonable user format on
every primitive. Byte-array fields already accepted optional 0x via
Strip0xHex; this extends the same tolerance to numeric hex Amount and
Balance, matching how EVM-flavored callers (wallet, allset-sdk, x402)
naturally hand hex strings to the SDK.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Document `*FromRpc` cross-sign rationale (item #2)

**Files:**

- Modify: `packages/fast-schema/src/base/rpc.ts` (top-of-file comment)

- [ ] **Step 1: Add the header comment**

Edit `packages/fast-schema/src/base/rpc.ts`. Insert at the top, before the existing imports:

```ts
/**
 * Legacy JSON-RPC wire-form primitives.
 *
 * This palette describes the wire format the Fast network used before the
 * REST migration (PR #76, Apr 2026). It survives the migration solely
 * because `allset-sdk/src/bridge.ts` still encodes `TransactionCertificate`
 * to it for the AllSet cross-sign service — a JSON-RPC service that has
 * not migrated.
 *
 * **Direction in production:** encode-only. The cross-sign request handler
 * calls `Schema.encodeSync(TransactionCertificateFromRpc)(...)` to produce
 * the wire payload. Decode is exercised only by hand-authored test fixtures
 * (see `packages/allset-sdk/tests/sdk.test.ts`).
 *
 * **Wire shape:**
 *   - Addresses, byte arrays: hex strings (no 0x prefix), numeric arrays in some places
 *   - Amount / Balance: lowercase hex via Rust's `to_str_radix(16)` (no 0x, sign only on signed types)
 *   - Nonce / Quorum: JSON numbers (u64)
 *
 * Do not extend this palette without coordinating with the cross-sign
 * service owners. Once cross-sign migrates to REST, this entire palette
 * (and `TransactionCertificateFromRpc` etc.) can be deleted.
 */
```

- [ ] **Step 2: Verify nothing changed structurally**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
cd packages/fast-schema && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/fast-schema/src/base/rpc.ts
git commit -m "$(cat <<'EOF'
docs(fast-schema): explain why *FromRpc survives REST migration

Adds a top-of-file comment documenting that this palette is kept solely
for the AllSet cross-sign JSON-RPC service (encode-only in production).
Future readers should not mistake it for dead code from the REST migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verify and delete `JsonRpcError` orphans (item #3)

**Files:**

- Modify: `packages/fast-schema/src/errors/fastset.ts`
- Modify: `packages/fast-schema/src/errors/index.ts`
- Modify: `packages/fast-schema/tests/unit/errors.test.ts`

**Context:** `JsonRpcError` and `ProxyErrorData.RpcError` were left behind by the REST migration. Final verification grep confirms no production consumer; tests can be removed.

- [ ] **Step 1: Verify no consumers (final grep)**

```bash
grep -rn "JsonRpcError\|ProxyErrorData\.RpcError" packages/ --include="*.ts" 2>/dev/null | grep -v dist/ | grep -v ".test."
grep -rn "JsonRpcError" /home/yuqing/Documents/Code/fastset-wallet-browser-extension/src 2>/dev/null
```

Expected: only declarations in `errors/fastset.ts` and `errors/index.ts`. **STOP** and inform the user if any production consumer is found — design assumption is violated.

- [ ] **Step 2: Delete `JsonRpcError` from `errors/fastset.ts`**

Edit `packages/fast-schema/src/errors/fastset.ts`:

- Delete lines 31-37 (the `JsonRpcError` const, its type alias, and the JSDoc).
- Inside `ProxyErrorData`, delete the line `RpcError: JsonRpcError,` (line 43).

The resulting file should keep `FastSetErrorData`, `ProxyErrorData` (without `RpcError`), and their type aliases.

- [ ] **Step 3: Delete the export from `errors/index.ts`**

Edit `packages/fast-schema/src/errors/index.ts`. Change:

```ts
export { FastSetErrorData, JsonRpcError, ProxyErrorData } from './fastset.ts';
```

to:

```ts
export { FastSetErrorData, ProxyErrorData } from './fastset.ts';
```

- [ ] **Step 4: Delete the related test cases**

Edit `packages/fast-schema/tests/unit/errors.test.ts`:

- Delete the entire `describe('JsonRpcError', () => { ... })` block (lines 88-110 approximately).
- Inside `describe('ProxyErrorData', ...)`, delete any `it(...)` blocks that reference `RpcError` (search for `'RpcError'` and remove).
- Update the import line at the top to drop `JsonRpcError`.

- [ ] **Step 5: Run all schema tests**

```bash
cd packages/fast-schema && pnpm exec vitest run
```

Expected: PASS.

- [ ] **Step 6: Verify downstream typechecks**

```bash
cd packages/fast-sdk && pnpm exec tsc --noEmit
cd ../allset-sdk && pnpm exec tsc --noEmit
cd ../x402-facilitator && pnpm exec tsc --noEmit
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/fast-schema/src/errors/ packages/fast-schema/tests/unit/errors.test.ts
git commit -m "$(cat <<'EOF'
refactor(fast-schema): remove orphaned JsonRpcError and ProxyErrorData.RpcError

The JsonRpcError variant was the JSON-RPC error wrapper before the REST
migration. After the migration, ProxyErrorData lost its RpcError variant
in production paths but the schema declaration remained. Verified no
non-test consumers across the workspace and the wallet extension repo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Add Wave 1 changeset entry

**Files:**

- Create: `.changeset/fast-schema-cleanup-wave-1.md`

- [ ] **Step 1: Pick the right bump level**

Wave 1 is non-breaking on the public API surface (one new strict primitive added; one new compose in Input that only loosens behavior; orphan deletions don't affect any consumer per Step 1 of Task 7). Use **patch** for `@fastxyz/schema`.

- [ ] **Step 2: Create the changeset**

Create `.changeset/fast-schema-cleanup-wave-1.md`:

```markdown
---
"@fastxyz/schema": patch
---

Restore palette discipline (wave 1):

- Encode `ProxySubmitTransactionResult` unit variants as `{Name: []}` (matching Rust's tuple-variant wire form), not bare strings.
- Add `HexLowerBigInt` family for strict-lowercase RPC hex; switch `AmountFromRpc`/`BalanceFromRpc` to use it.
- `AmountFromInput`/`BalanceFromInput` now accept `0x`-prefixed hex (matches existing byte-field behavior).
- Document `*FromRpc` rationale (kept for AllSet cross-sign service).
- Remove orphaned `JsonRpcError` and `ProxyErrorData.RpcError` (no production consumers).
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/fast-schema-cleanup-wave-1.md
git commit -m "chore: changeset for fast-schema palette discipline cleanup wave 1"
```

---

### Task 9: Wave 1 final verification

- [ ] **Step 1: Run the full repo test + typecheck**

```bash
cd packages/fast-schema && pnpm exec vitest run && pnpm exec tsc --noEmit
cd ../fast-sdk && pnpm exec tsc --noEmit
cd ../allset-sdk && pnpm exec vitest run 2>&1 | tail && pnpm exec tsc --noEmit
cd ../x402-facilitator && pnpm exec tsc --noEmit
```

Expected: all green. If `fast-schema` tsc fails because of the Task 4 (palette/bcs.ts duplicate function the user fixed earlier), confirm the user's fix is in place.

- [ ] **Step 2: Push branch and open Wave 1 PR**

```bash
git push -u origin cleanup/schema-palette-discipline
gh pr create --base develop --title "chore(fast-schema): palette discipline cleanup (wave 1)" --body "$(cat <<'EOF'
## Summary

Wave 1 of the palette discipline cleanup designed in
`docs/superpowers/specs/2026-05-04-fast-schema-cleanup-design.md`.
Schema-internal only; no cross-repo dependency.

Items in this PR:

- **#4** Encode `ProxySubmitTransactionResult` unit variants as `{Name: []}`
- **#8** Add `HexLowerBigInt` family; switch `*FromRpc` to use it
- **#9** `AmountFromInput`/`BalanceFromInput` accept `0x`-prefixed hex
- **#2** Document `*FromRpc` cross-sign rationale
- **#3** Remove orphaned `JsonRpcError` / `ProxyErrorData.RpcError`

Item **#1** (REST tighten + new `TransportPalette`) is Wave 2 and ships in a coordinated PR with the wallet extension.

## Test plan

- [ ] All `@fastxyz/schema` vitest tests pass (new tests in `tests/unit/composite/response.test.ts`, `tests/unit/util/numeric.test.ts`, `tests/unit/base/rpc.test.ts`, `tests/unit/base/input.test.ts`).
- [ ] `tsc --noEmit` clean across `fast-schema`, `fast-sdk`, `allset-sdk`, `x402-facilitator`.
- [ ] `allset-sdk` vitest passes (cross-sign uses the strict RPC encode path).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for review and merge**

Manual step. Wave 2 cannot start until Wave 1 has merged AND `@fastxyz/schema` has been published to npm with the new patch version (changeset workflow handles publication on merge to `main` after the version PR is merged).

---

## ⏸️ PAUSE GATE — Wave 1 must merge AND publish before Wave 2 starts

**Do not begin Wave 2 until:**

1. Wave 1 PR is merged into `develop`.
2. The follow-up changesets version PR is merged into `main`.
3. `@fastxyz/schema` is published to npm at the new patch version (verify via `npm view @fastxyz/schema version`).

This avoids the schema-version bump in Wave 2 colliding with the Wave 1 version bump.

---

## Wave 2 — REST tighten + TransportPalette + extension migration

Wave 2 lands on a fresh branch `cleanup/transport-palette` cut from `develop` after Wave 1 has merged.

### Task 10: Branch setup for Wave 2

- [ ] **Step 1: Cut a fresh branch from updated `develop`**

```bash
git fetch origin
git checkout develop && git pull
git checkout -b cleanup/transport-palette
```

- [ ] **Step 2: Verify Wave 1 changes are present**

```bash
grep -q "HexLowerBigInt" packages/fast-schema/src/util/numeric.ts && echo "Wave 1 present"
```

Expected: prints "Wave 1 present". If not, Wave 1 hasn't merged — STOP.

---

### Task 11: Add strict bigint helpers (`BigIntFromNumberOrSelf`)

**Files:**

- Modify: `packages/fast-schema/src/util/numeric.ts`
- Modify: `packages/fast-schema/tests/unit/util/numeric.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/fast-schema/tests/unit/util/numeric.test.ts`:

```ts
import {
  BigIntFromNumberOrSelf,
  IntBigIntFromNumberOrSelf,
  UintBigIntFromNumberOrSelf,
} from '../../../src/util/numeric.ts';

describe('BigIntFromNumberOrSelf (strict — no string)', () => {
  it('accepts bigint passthrough', () => {
    expect(decodeSync(BigIntFromNumberOrSelf, 42n)).toBe(42n);
  });

  it('accepts number', () => {
    expect(decodeSync(BigIntFromNumberOrSelf, 42)).toBe(42n);
  });

  it('rejects string (this is the wire-fidelity contract for REST)', () => {
    expect(() => decodeSync(BigIntFromNumberOrSelf, '42')).toThrow();
  });
});

describe('UintBigIntFromNumberOrSelf', () => {
  it('rejects negative number', () => {
    const u = UintBigIntFromNumberOrSelf(64);
    expect(() => decodeSync(u, -1)).toThrow();
  });

  it('rejects out-of-range', () => {
    const u = UintBigIntFromNumberOrSelf(8);
    expect(() => decodeSync(u, 256)).toThrow();
  });

  it('accepts in-range bigint', () => {
    const u = UintBigIntFromNumberOrSelf(64);
    expect(decodeSync(u, 100n)).toBe(100n);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/util/numeric.test.ts
```

Expected: import errors — symbols don't exist.

- [ ] **Step 3: Add the strict helpers**

Append to `packages/fast-schema/src/util/numeric.ts`:

```ts
/**
 * Upcasts a `number | bigint` to `bigint`.
 *
 * Strict counterpart to `BigIntFromNumberOrStringOrSelf` — rejects string
 * input. Use in `RestPalette` (wire-faithful: REST never emits stringified
 * bigints; only `TransportPalette` accepts the post-`String(bigint)` form).
 */
export const BigIntFromNumberOrSelf = Schema.transform(
  Schema.Union(Schema.Number, Schema.BigIntFromSelf),
  Schema.BigIntFromSelf,
  {
    strict: true,
    decode: (n) => (typeof n === 'bigint' ? n : BigInt(n)),
    encode: (n) => n,
  },
);

/** number | bigint to branded unsigned bigint. */
export const UintBigIntFromNumberOrSelf = <N extends number>(bits: N) =>
  Schema.compose(BigIntFromNumberOrSelf, UintBigInt(bits));

/** number | bigint to branded signed bigint. */
export const IntBigIntFromNumberOrSelf = <N extends number>(bits: N) =>
  Schema.compose(BigIntFromNumberOrSelf, IntBigInt(bits));
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/util/numeric.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-schema/src/util/numeric.ts packages/fast-schema/tests/unit/util/numeric.test.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): add strict BigIntFromNumberOrSelf helpers

Adds wire-faithful (number | bigint, no string) counterparts:
BigIntFromNumberOrSelf, UintBigIntFromNumberOrSelf, IntBigIntFromNumberOrSelf.
The widened *FromNumberOrStringOrSelf helpers stay as-is — they're used by
the Input and Transport palettes where string tolerance is intentional.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Add sized strict instances (`Uint64FromNumberOrSelf` etc.)

**Files:**

- Modify: `packages/fast-schema/src/util/instances.ts`
- Modify: `packages/fast-schema/src/util/index.ts`

- [ ] **Step 1: Add instances to `instances.ts`**

Edit `packages/fast-schema/src/util/instances.ts`. Add to imports:

```ts
import {
  // ...existing...
  IntBigIntFromNumberOrSelf,
  UintBigIntFromNumberOrSelf,
} from './numeric.ts';
```

Append after `Int320FromNumberOrStringOrSelf`:

```ts
/** number | bigint to branded Uint64 (REST wire-faithful). */
export const Uint64FromNumberOrSelf = UintBigIntFromNumberOrSelf(64);

/** number | bigint to branded Uint256 (REST wire-faithful). */
export const Uint256FromNumberOrSelf = UintBigIntFromNumberOrSelf(256);

/** number | bigint to branded Int320 (REST wire-faithful). */
export const Int320FromNumberOrSelf = IntBigIntFromNumberOrSelf(320);
```

- [ ] **Step 2: Re-export from `util/index.ts`**

Edit `packages/fast-schema/src/util/index.ts`. Add to the existing instance re-export:

```ts
export {
  // ...existing...
  Int320FromNumberOrSelf,
  Uint64FromNumberOrSelf,
  Uint256FromNumberOrSelf,
} from './instances.ts';

export {
  // ...existing...
  BigIntFromNumberOrSelf,
  IntBigIntFromNumberOrSelf,
  UintBigIntFromNumberOrSelf,
} from './numeric.ts';
```

- [ ] **Step 3: Verify build + tests**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit && pnpm exec vitest run
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/fast-schema/src/util/instances.ts packages/fast-schema/src/util/index.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): export sized strict instances Uint64/Uint256/Int320FromNumberOrSelf

Sized strict instances for use in RestPalette's Nonce/Quorum/Amount/Balance
primitives. Re-exported from util/index.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Create `base/transport.ts`

**Files:**

- Create: `packages/fast-schema/src/base/transport.ts`

**Context:** Mirrors `base/rest.ts` but uses the loose `*FromNumberOrStringOrSelf` helpers for bigint primitives. All other primitives are aliased to their REST counterparts (no widening).

- [ ] **Step 1: Create the file**

Create `packages/fast-schema/src/base/transport.ts`:

```ts
/**
 * Transport-tolerant wire primitives.
 *
 * Sibling to `base/rest.ts`. Identical shape on every primitive **except**
 * the bigint-typed ones (Nonce, Quorum), which additionally accept string
 * input. Use this palette wherever a REST-shaped payload has crossed a
 * JSON-string transport boundary that doesn't preserve bigint natively
 * (Chrome extension `port.postMessage` after a `JSON.stringify(bigint→String)`
 * mangling step is the canonical case).
 *
 * Encode direction is identical to REST. Only the decode acceptance is wider.
 */

import { Schema } from 'effect';
import {
  Uint64FromNumberOrStringOrSelf,
} from '../util/index.ts';
import {
  AddressFromRest,
  AmountFromRest,
  BalanceFromRest,
  ClaimDataFromRest,
  NetworkIdFromRest,
  SignatureFromRest,
  StateFromRest,
  StateKeyFromRest,
  TokenIdFromRest,
  UserDataFromRest,
} from './rest.ts';

export const NonceFromTransport = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromTransport = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Quorum'));

// Already string-typed on the wire — alias REST.
export const NetworkIdFromTransport = NetworkIdFromRest;
export const AddressFromTransport = AddressFromRest;
export const SignatureFromTransport = SignatureFromRest;
export const TokenIdFromTransport = TokenIdFromRest;
export const StateKeyFromTransport = StateKeyFromRest;
export const StateFromTransport = StateFromRest;
export const ClaimDataFromTransport = ClaimDataFromRest;
export const UserDataFromTransport = UserDataFromRest;
export const AmountFromTransport = AmountFromRest;
export const BalanceFromTransport = BalanceFromRest;
```

- [ ] **Step 2: Verify build**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/fast-schema/src/base/transport.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): add base/transport.ts with widened bigint primitives

Mirrors base/rest.ts but Nonce/Quorum accept string input (post-
String(bigint) form). All other primitives alias REST verbatim. Use this
palette for payloads that have crossed a JSON-string transport boundary
(Chrome port, etc.) where bigint can't survive natively.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Add `TransportPalette` to `palette/definition.ts`

**Files:**

- Modify: `packages/fast-schema/src/palette/definition.ts`

- [ ] **Step 1: Add the palette**

Edit `packages/fast-schema/src/palette/definition.ts`. Add to imports:

```ts
import {
  AddressFromTransport,
  AmountFromTransport,
  BalanceFromTransport,
  ClaimDataFromTransport,
  NetworkIdFromTransport,
  NonceFromTransport,
  QuorumFromTransport,
  SignatureFromTransport,
  StateFromTransport,
  StateKeyFromTransport,
  TokenIdFromTransport,
  UserDataFromTransport,
} from '../base/transport.ts';
```

After the `RestPalette` definition, add:

```ts
export const TransportPalette = {
  Amount: AmountFromTransport,
  Balance: BalanceFromTransport,
  Nonce: NonceFromTransport,
  Quorum: QuorumFromTransport,
  NetworkId: NetworkIdFromTransport,
  Address: AddressFromTransport,
  Signature: SignatureFromTransport,
  TokenId: TokenIdFromTransport,
  StateKey: StateKeyFromTransport,
  State: StateFromTransport,
  ClaimData: ClaimDataFromTransport,
  UserData: UserDataFromTransport,
  BigInt: BigIntFromNumberOrStringOrSelf,
} satisfies BasePalette;
```

- [ ] **Step 2: Verify build**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/fast-schema/src/palette/definition.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): add TransportPalette alongside Rest/Bcs/Rpc

TransportPalette = RestPalette with widened bigint primitives. Used by
the new palette/transport.ts factory-derived schemas (next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Create `palette/transport.ts` factory-derived schemas

**Files:**

- Create: `packages/fast-schema/src/palette/transport.ts`
- Test: `packages/fast-schema/tests/unit/palette/transport.test.ts` (create)

**Context:** Run the existing factory functions with `TransportPalette` to derive the composite schemas the wallet extension needs to decode after the port-bridge mangling. Scope kept narrow per the spec — only the schemas the extension actually decodes.

- [ ] **Step 1: Write the failing tests**

Create `packages/fast-schema/tests/unit/palette/transport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  TransactionCertificateFromTransport,
  AccountInfoResponseFromTransport,
} from '../../../src/palette/transport.ts';
import {
  TransactionCertificateFromRest,
  AccountInfoResponseFromRest,
} from '../../../src/palette/rest.ts';

// Minimal valid certificate fixture in REST encoded shape (with bigint nonces stringified
// to simulate post-port mangling).
const STRINGY_CERT_FIXTURE = {
  envelope: {
    transaction: {
      Release20260407: {
        network_id: 'fast:testnet',
        sender: 'fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqs7tlckk',
        nonce: '9999999999999999999',         // ← string form, > 2^53
        timestamp_nanos: '1700000000000000000', // ← string form
        claims: [],
        archival: false,
        fee_token: null,
      },
    },
    signature: { Signature: '0'.repeat(128) },
  },
  signatures: [],
};

describe('TransportPalette accepts post-port-mangling string forms', () => {
  it('TransactionCertificateFromTransport decodes string-form nonce', () => {
    const decoded = Schema.decodeUnknownSync(TransactionCertificateFromTransport)(STRINGY_CERT_FIXTURE);
    expect(decoded.envelope.transaction.value.nonce).toBe(9999999999999999999n);
  });

  it('TransactionCertificateFromRest rejects the same string-form nonce (regression guard)', () => {
    expect(() =>
      Schema.decodeUnknownSync(TransactionCertificateFromRest)(STRINGY_CERT_FIXTURE),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/palette/transport.test.ts
```

Expected: import error — `palette/transport.ts` doesn't exist yet. (Note: `TransactionCertificateFromRest` rejecting the stringy form will only become true after Task 16; we accept that this test currently fails for two reasons — that's OK, it'll be fully green after Task 16.)

- [ ] **Step 3: Create `palette/transport.ts`**

Create `packages/fast-schema/src/palette/transport.ts`:

```ts
/**
 * Transport-tolerant composite schemas.
 *
 * Factory-derived from `TransportPalette`. Use these in code paths where a
 * REST-encoded payload has crossed a JSON-string transport boundary
 * (Chrome extension `port.postMessage` after a `JSON.stringify(bigint→String)`
 * mangling). The schemas have the same encoded shape as their REST
 * counterparts on every byte/hex/decimal field, but additionally accept
 * string-form input on bigint-typed primitives (Nonce, Quorum, etc.).
 *
 * Scope is intentionally narrow — only the schemas the wallet extension
 * decodes are exported. Add more here only when a real consumer needs them.
 */

import {
  makeTransactionCertificate,
} from '../composite/envelope.ts';
import {
  makeAccountInfoResponse,
  makeTokenInfoResponse,
} from '../composite/response.ts';
import { TransportPalette } from './definition.ts';

const p = TransportPalette;

export const TransactionCertificateFromTransport = makeTransactionCertificate(p);
export const AccountInfoResponseFromTransport = makeAccountInfoResponse(p);
export const TokenInfoResponseFromTransport = makeTokenInfoResponse(p);

// Domain type aliases (Type form is identical to REST counterparts; alias for ergonomics)
export type TransactionCertificateTransport = typeof TransactionCertificateFromTransport.Type;
export type AccountInfoResponseTransport = typeof AccountInfoResponseFromTransport.Type;
export type TokenInfoResponseTransport = typeof TokenInfoResponseFromTransport.Type;
```

- [ ] **Step 4: Run tests — should pass for the positive case**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/palette/transport.test.ts
```

Expected: positive test (TransportPalette accepts) PASSES. Negative test (RestPalette rejects) STILL FAILS — gets fixed in Task 16.

- [ ] **Step 5: Commit**

```bash
git add packages/fast-schema/src/palette/transport.ts packages/fast-schema/tests/unit/palette/transport.test.ts
git commit -m "$(cat <<'EOF'
feat(fast-schema): add palette/transport.ts factory-derived schemas

Exports TransactionCertificateFromTransport, AccountInfoResponseFromTransport,
TokenInfoResponseFromTransport — the schemas the wallet extension decodes
after its port-bridge JSON.stringify(bigint→String) mangling.

Negative-side regression test (RestPalette rejects stringy form) is in
the same test file and currently fails — to be fixed in the next commit
that tightens RestPalette.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Tighten `base/rest.ts` to wire-faithful

**Files:**

- Modify: `packages/fast-schema/src/base/rest.ts`

**Context:** This is the breaking change for the wallet extension. Switching `NonceFromRest`/`QuorumFromRest` from `Uint64FromNumberOrStringOrSelf` to `Uint64FromNumberOrSelf` makes them reject string input — exactly the form the wallet sends through the port. The extension will be migrated in Task 21 to use `*FromTransport` instead.

- [ ] **Step 1: Switch the imports**

Edit `packages/fast-schema/src/base/rest.ts`. Replace:

```ts
import {
  // ...
  Uint64FromNumberOrStringOrSelf,
} from '../util/index.ts';
```

with:

```ts
import {
  // ...
  Uint64FromNumberOrSelf,
} from '../util/index.ts';
```

- [ ] **Step 2: Switch the brand definitions**

In the same file, replace:

```ts
export const NonceFromRest = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRest = Uint64FromNumberOrStringOrSelf.pipe(Schema.brand('Quorum'));
```

with:

```ts
export const NonceFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Nonce'));
export const QuorumFromRest = Uint64FromNumberOrSelf.pipe(Schema.brand('Quorum'));
```

- [ ] **Step 3: Add header comment**

At the top of `packages/fast-schema/src/base/rest.ts`, before the imports:

```ts
/**
 * REST wire-form primitives.
 *
 * Wire-faithful — every primitive accepts only what the Fast proxy actually
 * emits over REST. NO defensive widening for downstream transports.
 *
 * If a payload has crossed a JSON-string transport boundary that doesn't
 * preserve bigint natively (e.g. Chrome extension `port.postMessage` after a
 * `JSON.stringify(bigint→String)` step), use `TransportPalette` /
 * `*FromTransport` instead. Transport is identical to REST except for
 * widened bigint primitives.
 */
```

- [ ] **Step 4: Run the Task-15 test that was previously failing**

```bash
cd packages/fast-schema && pnpm exec vitest run tests/unit/palette/transport.test.ts
```

Expected: BOTH tests pass now (positive: Transport accepts; negative: REST rejects).

- [ ] **Step 5: Run all schema tests**

```bash
cd packages/fast-schema && pnpm exec vitest run
```

Expected: all pass.

- [ ] **Step 6: Run downstream typechecks**

```bash
cd packages/fast-sdk && pnpm exec tsc --noEmit
cd ../allset-sdk && pnpm exec tsc --noEmit
cd ../x402-facilitator && pnpm exec tsc --noEmit
```

Expected: green. The downstream packages don't pass string-form bigints to REST schemas, so they're unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/fast-schema/src/base/rest.ts
git commit -m "$(cat <<'EOF'
refactor(fast-schema)!: tighten RestPalette Nonce/Quorum to wire-faithful

NonceFromRest and QuorumFromRest now use Uint64FromNumberOrSelf instead of
Uint64FromNumberOrStringOrSelf — they no longer accept string input, which
REST wire never emits. Code paths that need to accept the post-
String(bigint) form (Chrome port boundary) must switch to *FromTransport.

BREAKING CHANGE: Decoding REST payloads where Nonce/Quorum arrive as
string (e.g. after JSON.stringify(bigint→String) mangling) now fails.
Use TransactionCertificateFromTransport / AccountInfoResponseFromTransport /
TokenInfoResponseFromTransport from @fastxyz/schema instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Re-export Transport symbols from package indexes

**Files:**

- Modify: `packages/fast-schema/src/base/index.ts`
- Modify: `packages/fast-schema/src/palette/index.ts`

- [ ] **Step 1: Update `base/index.ts`**

Edit `packages/fast-schema/src/base/index.ts`. Add re-exports:

```ts
export {
  AddressFromTransport,
  AmountFromTransport,
  BalanceFromTransport,
  ClaimDataFromTransport,
  NetworkIdFromTransport,
  NonceFromTransport,
  QuorumFromTransport,
  SignatureFromTransport,
  StateFromTransport,
  StateKeyFromTransport,
  TokenIdFromTransport,
  UserDataFromTransport,
} from './transport.ts';
```

- [ ] **Step 2: Update `palette/index.ts`**

Edit `packages/fast-schema/src/palette/index.ts`. Add `TransportPalette` to the re-export from `definition.ts`:

```ts
export { BcsPalette, RestPalette, RpcPalette, TransportPalette } from './definition.ts';
```

Add re-export from the new palette file:

```ts
export {
  AccountInfoResponseFromTransport,
  TokenInfoResponseFromTransport,
  TransactionCertificateFromTransport,
} from './transport.ts';

export type {
  AccountInfoResponseTransport,
  TokenInfoResponseTransport,
  TransactionCertificateTransport,
} from './transport.ts';
```

- [ ] **Step 3: Verify package exports work end-to-end**

```bash
cd packages/fast-schema && pnpm exec tsc --noEmit
```

Then create a tiny verification:

```bash
cd packages/fast-schema && cat > /tmp/verify-exports.ts <<'EOF'
import { TransactionCertificateFromTransport, TransportPalette } from './src/index.ts';
console.log(typeof TransactionCertificateFromTransport, typeof TransportPalette);
EOF
pnpm exec tsx /tmp/verify-exports.ts
```

Expected: prints "object object" and exits 0.

```bash
rm /tmp/verify-exports.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/fast-schema/src/base/index.ts packages/fast-schema/src/palette/index.ts
git commit -m "$(cat <<'EOF'
chore(fast-schema): re-export Transport palette symbols from package indexes

Makes TransportPalette and the *FromTransport schemas part of the
@fastxyz/schema public API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Add Wave 2 changeset entry

**Files:**

- Create: `.changeset/fast-schema-cleanup-wave-2.md`

- [ ] **Step 1: Create the changeset (major bump — breaking)**

Create `.changeset/fast-schema-cleanup-wave-2.md`:

```markdown
---
"@fastxyz/schema": major
---

Restore palette discipline (wave 2 — REST tightening + new TransportPalette).

**Breaking change:** `NonceFromRest` and `QuorumFromRest` no longer accept string-form input. REST is now wire-faithful.

**Migration:** if you decode REST-shaped payloads that have crossed a JSON-string transport boundary (Chrome extension `port.postMessage` is the canonical case), import the new `*FromTransport` schemas instead:

```diff
- import { TransactionCertificateFromRest } from '@fastxyz/schema';
+ import { TransactionCertificateFromTransport } from '@fastxyz/schema';
```

The encoded shape is identical except that `*FromTransport` additionally accepts string-form bigint fields. Wallet integrations and any other consumer that round-trips REST payloads through `JSON.stringify(bigint → String)` should migrate.

**New exports:**

- `TransportPalette`
- `TransactionCertificateFromTransport`
- `AccountInfoResponseFromTransport`
- `TokenInfoResponseFromTransport`
- `*FromTransport` primitives (Address, Amount, Balance, …)
- `BigIntFromNumberOrSelf`, `Uint64FromNumberOrSelf`, etc. (strict counterparts)

```

- [ ] **Step 2: Commit**

```bash
git add .changeset/fast-schema-cleanup-wave-2.md
git commit -m "chore: changeset for fast-schema palette discipline cleanup wave 2 (major)"
```

---

### Task 19: Wave 2 schema PR — push, open, await merge & publish

- [ ] **Step 1: Push branch**

```bash
git push -u origin cleanup/transport-palette
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base develop --title "feat(fast-schema)!: REST tighten + new TransportPalette (wave 2)" --body "$(cat <<'EOF'
## Summary

Wave 2 of the palette discipline cleanup designed in
`docs/superpowers/specs/2026-05-04-fast-schema-cleanup-design.md`.
Tightens `RestPalette` to wire-faithful; ships a new `TransportPalette`
for code paths that need to decode REST-shaped payloads after a
JSON-string transport boundary.

**Breaking** for downstream consumers that decode REST after a
`JSON.stringify(bigint→String)` step. The wallet extension is the only
known consumer; its migration PR opens immediately after this one
publishes to npm.

## Test plan

- [ ] All `@fastxyz/schema` vitest tests pass.
- [ ] `tsc --noEmit` clean across `fast-schema`, `fast-sdk`, `allset-sdk`, `x402-facilitator`.
- [ ] New negative regression test: `TransactionCertificateFromRest` rejects string-form Nonce.
- [ ] New positive test: `TransactionCertificateFromTransport` accepts string-form Nonce.
- [ ] Manual verification: wallet extension repo, on a worktree with this
  schema linked, decodes a port-roundtripped certificate via the new
  `*FromTransport` import (covered by the Wave-2 extension PR).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for review and merge**

Manual step. After merge, the changesets workflow opens a version PR. Merge that, and the publish workflow ships `@fastxyz/schema@<new-major>` to npm.

- [ ] **Step 4: Verify npm publication**

```bash
npm view @fastxyz/schema version
```

Expected: prints the new major version. **Do not start Task 20 until this matches.**

---

### Task 20: Extension migration — branch and dependency bump

**Files (extension repo):**

- Modify: `/home/yuqing/Documents/Code/fastset-wallet-browser-extension/package.json`

- [ ] **Step 1: Switch to extension repo and create branch**

```bash
cd /home/yuqing/Documents/Code/fastset-wallet-browser-extension
git fetch origin
git checkout main && git pull   # or whatever the default branch is
git checkout -b cleanup/use-transport-palette
```

- [ ] **Step 2: Bump `@fastxyz/schema`**

Find the new published version: `npm view @fastxyz/schema version`. Update the dep in `package.json`:

```bash
pnpm up @fastxyz/schema@latest
```

Verify lockfile changed:

```bash
git diff package.json pnpm-lock.yaml | head -30
```

- [ ] **Step 3: Verify tsc currently breaks (proves the migration is needed)**

```bash
pnpm exec tsc --noEmit 2>&1 | head -20
```

Expected: no errors yet on the extension code itself, but the type identity of `TransactionCertificateFromRest`'s encoded shape narrowed (no longer accepts `string` for nonce). The runtime breakage will surface in the new test we add in Task 22.

- [ ] **Step 4: Commit dependency bump**

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(deps): bump @fastxyz/schema to <new-version>

Required by the next commits that swap the cross-port encode/decode
boundary to *FromTransport. Without the swap, runtime decode of port-
roundtripped certificates throws.
EOF
)"
```

(Replace `<new-version>` with the actual new version.)

---

### Task 21: Extension migration — swap imports

**Files (extension repo):**

- Modify: `src/core/api/txn.ts`
- Modify: `src/scripts/content/dapp-api.ts` (find via grep — see Step 1)

- [ ] **Step 1: Find every `*FromRest` import that goes through the port**

```bash
grep -rn "TransactionCertificateFromRest\|AccountInfoResponseFromRest\|TokenInfoResponseFromRest" src/ --include="*.ts" --include="*.tsx"
```

Expected: matches in `src/core/api/txn.ts` and `src/scripts/content/dapp-api.ts`. **Important:** if you find a use in code that decodes directly from the REST proxy (e.g. inside `FastProvider`), DO NOT change that one — only the cross-port encode/decode pair migrates.

- [ ] **Step 2: Update `src/core/api/txn.ts`**

Edit the file. Three changes:

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

- [ ] **Step 3: Update `src/scripts/content/dapp-api.ts`**

Edit the file — change every `TransactionCertificateFromRest` reference inside this file to `TransactionCertificateFromTransport` (use `Edit` with `replace_all: true` for that single symbol within the file). Update the import line accordingly.

- [ ] **Step 4: Run tsc**

```bash
pnpm exec tsc --noEmit
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/core/api/txn.ts src/scripts/content/dapp-api.ts
git commit -m "$(cat <<'EOF'
refactor(api): swap port-boundary decode from *FromRest to *FromTransport

@fastxyz/schema's RestPalette is now wire-faithful and rejects the
string-form Nonce/Quorum that our JSON.stringify(bigint→String) port
transport produces. TransportPalette is the new sibling that accepts
exactly that form (otherwise identical to REST).

Affects both the encode side (encodeForPort in core/api/txn.ts) and
the symmetric decode site in scripts/content/dapp-api.ts.
EOF
)"
```

---

### Task 22: Extension migration — round-trip regression test

**Files (extension repo):**

- Create: `src/core/api/__tests__/txn-port-roundtrip.test.ts`

**Context:** This test is the discipline guard for the extension. If a future contributor accidentally reverts to `*FromRest`, this test fails — proving the migration was load-bearing.

- [ ] **Step 1: Verify the extension's test setup**

```bash
ls vitest.config.* 2>/dev/null
grep -l '"test"' package.json | head
cat package.json | grep -A 1 '"test"'
```

If no test config exists, this task expands to "set up vitest first" — coordinate with the user before proceeding.

- [ ] **Step 2: Write the round-trip test**

Create `src/core/api/__tests__/txn-port-roundtrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  TransactionCertificateFromTransport,
  TransactionCertificateFromRest,
} from '@fastxyz/schema';

const NON_TRIVIAL_NONCE = 9999999999999999999n; // > 2^53

const buildFakeCert = () => ({
  envelope: {
    transaction: {
      type: 'Release20260407',
      value: {
        networkId: 'fast:testnet',
        sender: new Uint8Array(32),
        nonce: NON_TRIVIAL_NONCE,
        timestampNanos: 1700000000000000000n,
        claims: [],
        archival: false,
        feeToken: null,
      },
    },
    signature: { type: 'Signature', value: new Uint8Array(64) },
  },
  signatures: [],
});

describe('cross-port round-trip', () => {
  it('encode → JSON.stringify(bigint→String) → JSON.parse → decode preserves Nonce via *FromTransport', () => {
    const cert = buildFakeCert();
    const encoded = Schema.encodeSync(TransactionCertificateFromTransport)(cert as never);
    const wire = JSON.parse(JSON.stringify(encoded, (_, v) => typeof v === 'bigint' ? String(v) : v));
    const decoded = Schema.decodeUnknownSync(TransactionCertificateFromTransport)(wire);
    expect(decoded.envelope.transaction.value.nonce).toBe(NON_TRIVIAL_NONCE);
  });

  it('the same wire payload FAILS to decode via *FromRest (regression guard)', () => {
    const cert = buildFakeCert();
    const encoded = Schema.encodeSync(TransactionCertificateFromTransport)(cert as never);
    const wire = JSON.parse(JSON.stringify(encoded, (_, v) => typeof v === 'bigint' ? String(v) : v));
    expect(() => Schema.decodeUnknownSync(TransactionCertificateFromRest)(wire)).toThrow();
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm exec vitest run src/core/api/__tests__/txn-port-roundtrip.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 4: Manual smoke test**

```bash
pnpm build
```

Then load the built extension into Chrome (developer mode → load unpacked → select the build output directory). Send a `TokenTransfer` end-to-end. Confirm the transaction succeeds and the certificate appears in transaction history without error.

If anything errors at the cross-port boundary at runtime, **STOP and revert** — the migration is incomplete.

- [ ] **Step 5: Commit the test**

```bash
git add src/core/api/__tests__/txn-port-roundtrip.test.ts
git commit -m "$(cat <<'EOF'
test(api): add cross-port round-trip regression test

Locks in the *FromTransport import contract: encode → JSON.stringify
(bigint→String) → JSON.parse → decode round-trip succeeds via
TransportPalette and FAILS via RestPalette. If a future change swaps
back to *FromRest, this test fails immediately at CI.
EOF
)"
```

---

### Task 23: Extension PR

- [ ] **Step 1: Push and open**

```bash
git push -u origin cleanup/use-transport-palette
gh pr create --title "refactor: migrate cross-port boundary to TransportPalette" --body "$(cat <<'EOF'
## Summary

Migrates the wallet's cross-port encode/decode boundary to use
`*FromTransport` from `@fastxyz/schema`. Required by the schema's
Wave 2 release — `*FromRest` is now wire-faithful and rejects the
string-form Nonce produced by our `JSON.stringify(bigint→String)`
port transport.

Companion to fast-sdk PR <link>.

## Changes

- Bump `@fastxyz/schema` to <new-version>
- Swap `TransactionCertificateFromRest` → `TransactionCertificateFromTransport` in `src/core/api/txn.ts` and `src/scripts/content/dapp-api.ts`
- Add cross-port round-trip regression test

## Test plan

- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm exec vitest run` — all tests pass, including the new round-trip test
- [ ] Manual: build extension, install in Chrome, send a TokenTransfer end-to-end

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for review and merge**

After merge, the extension can be released to users. Wave 2 is complete.

---

## Verification — final pass criteria

After Wave 2 completes, the entire cleanup is done. Confirm:

- [ ] All `@fastxyz/schema` vitest tests pass.
- [ ] `tsc --noEmit` clean across `fast-schema`, `fast-sdk`, `allset-sdk`, `x402-facilitator`.
- [ ] Extension round-trip test passes against the published `@fastxyz/schema`, **fails** if reverted to `*FromRest`.
- [ ] Manual extension smoke test: `TokenTransfer` end-to-end works.
- [ ] `npm view @fastxyz/schema version` shows the new major.
- [ ] Spec doc `docs/superpowers/specs/2026-05-04-fast-schema-cleanup-design.md` checked off — every item (#2, #3, #4, #8, #9 in Wave 1; #1 in Wave 2) has corresponding commits.
