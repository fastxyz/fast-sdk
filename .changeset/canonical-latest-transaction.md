---
"@fastxyz/schema": major
"@fastxyz/sdk": major
"@fastxyz/x402-facilitator": patch
---

Replace `TransactionVersionRegistry` with canonical `LatestTransaction` + bidirectional bridges (mirrors Rust's `latest::Transaction` + `From` impls pattern).

### `@fastxyz/schema` — breaking

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
- `LatestFromRelease20260319`, `LatestFromRelease20260407` — per-version bidirectional bridges
- `LatestFromVersionedTransaction` — auto-dispatch decoder
- `encodeAsVersion(latest, version)` — encoder picking target version explicitly
- `VersionBridges` — typed registry, single source of truth for "what versions exist"
- `OperationRelease20260319`, `OperationRelease20260407` — per-version Operation enum schemas
- `Release20260319SupportedOperations`, `Release20260407SupportedOperations` — typed tag tuples
- `OperationFor<V>`, `SupportedOpTagFor<V>` — type-level helpers

### `@fastxyz/sdk` — breaking

- `TransactionBuilder` is now generic on `V extends TransactionVersion`. Existing usages without an explicit type parameter still work (defaults to `LatestTransactionVersion` = `'Release20260407'`).
- New primary `add(op)` method narrows on `OperationFor<V>` for compile-time per-version operation safety.
- `addEscrow(...)` returns `never` on `TransactionBuilder<'Release20260319'>` — TypeScript prevents the call at compile time. Runtime defense-in-depth via `VersionBridges[V].supportedOperations` check.

### `@fastxyz/x402-facilitator`

- Internal: BCS decode site now uses `LatestFromVersionedTransaction`. No public API change.
