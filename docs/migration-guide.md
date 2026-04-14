# Migration Guide

## Upgrading to `@fastxyz/sdk` v2 (Escrow + REST + Release20260407)

This release introduces three major changes:

1. **Full REST API migration** — all network calls use REST instead of JSON-RPC
2. **Release20260407 transaction format** — `claims[]` array replaces single `claim`
3. **Escrow feature support** — 8 new escrow operation types + query endpoints

---

### 1. Provider: `rpcUrl` → `url`

The `FastProvider` constructor option has been renamed from `rpcUrl` to `url`
to reflect the migration from JSON-RPC to REST.

```diff
- const provider = new FastProvider({ rpcUrl: "https://api.fast.xyz/proxy" });
+ const provider = new FastProvider({ url: "https://api.fast.xyz/proxy-rest" });
```

### 2. Default Transaction Version → Release20260407

`TransactionBuilder` now defaults to `Release20260407`. The key difference is
that transactions use a `claims` array instead of a single `claim` field.

**If you're building transactions**, no code changes are needed — the builder
handles the format automatically:

```ts
// This still works exactly the same
const envelope = await new TransactionBuilder({
  networkId: "fast:testnet",
  signer,
  nonce,
}).addTokenTransfer({ tokenId, recipient, amount: 1000n, userData: null })
  .sign();
```

**If you're reading raw transaction data**, update field access:

```diff
  const tx = envelope.transaction.value;
- const claim = tx.claim;             // Release20260319: single tagged union
- if (claim.type === "Batch") { ... } // had to check for Batch wrapper
+ const claims = tx.claims;           // Release20260407: always an array
+ for (const op of claims) { ... }    // iterate directly, no Batch wrapper
```

**To pin the old format** (not recommended), pass `version` explicitly:

```ts
new TransactionBuilder({
  networkId: "fast:testnet",
  signer,
  nonce,
  version: "Release20260319", // pin to old format
});
```

### 3. Error Classes

**Removed:**
- `JsonRpcProtocolError` — no longer applicable (REST API)
- `RpcError` — replaced by `RestError`

**Deprecated:**
- `RpcTimeoutError` — still exported as alias for `RestTimeoutError`, will be
  removed in a future release

**Added:**
- `RestError` — generic REST API error (non-200 response)
- `RestTimeoutError` — request timeout
- `NotFoundError` — 404 from proxy (e.g. unknown account, escrow job)
- `IpRateLimitedError` — 429, includes `retryAfterSecs`
- `UpstreamError` — 502, proxy can't reach validators
- `ServiceUnavailableError` — 503

```diff
  import {
-   JsonRpcProtocolError,
-   RpcError,
+   RestError,
+   RestTimeoutError,
+   NotFoundError,
+   IpRateLimitedError,
  } from "@fastxyz/sdk";
```

### 4. New: Escrow Operations

Use `addEscrow()` on `TransactionBuilder` to create escrow transactions:

```ts
import type { EscrowInputParams } from "@fastxyz/schema";

const envelope = await builder
  .addEscrow({
    type: "CreateJob",
    value: {
      configId,
      provider: providerAddress,
      evaluator: evaluatorAddress,
      tokenId,
      amount: 5000n,
      jobMetadata: new Uint8Array([]),
      userData: null,
    },
  })
  .sign();
```

All 8 escrow operation types are supported:
- `CreateConfig`, `CreateJob`, `AcceptJob`, `SubmitResult`
- `ApproveResult`, `RejectResult`, `CompleteJob`, `DisputeJob`

### 5. New: Escrow Query Methods

`FastProvider` now has two methods for querying escrow jobs:

```ts
// Get a single escrow job by ID
const job = await provider.getEscrowJob({
  jobId: 42n,
  certs: true, // include certificates
});

// List escrow jobs by role
const jobs = await provider.getEscrowJobs({
  client: myAddress,  // or: provider / evaluator
  status: "Active",
  certs: false,
});
```

### 6. Schema: Versioned Transaction Factories

If you use `@fastxyz/schema` directly, transaction factories are now versioned:

```diff
  import {
    makeTransaction,
+   makeTransactionRelease20260319,
+   makeTransactionRelease20260407,
+   LatestTransactionVersion,
  } from "@fastxyz/schema";

  // makeTransaction = latest (currently Release20260407)
  // Use named factories if you need a specific version
```

---

### Quick Checklist

- [ ] Replace `{ rpcUrl: ... }` with `{ url: ... }` in `FastProvider` calls
- [ ] Update proxy URLs from `/proxy` to `/proxy-rest`
- [ ] Replace `JsonRpcProtocolError` / `RpcError` imports with `RestError`
- [ ] Replace `RpcTimeoutError` with `RestTimeoutError`
- [ ] Update any raw transaction field access: `.claim` → `.claims[]`
- [ ] If using `@fastxyz/schema` directly: review versioned factory changes
- [ ] CLI: update custom network configs — `rpcUrl` → `url` in JSON files
