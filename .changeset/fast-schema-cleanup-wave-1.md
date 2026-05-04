---
"@fastxyz/schema": patch
---

Restore palette discipline (wave 1):

- Encode `ProxySubmitTransactionResult` unit variants as `{Name: []}` (matching Rust's tuple-variant wire form), not bare strings.
- Add `HexLowerBigInt` family for strict-lowercase RPC hex; switch `AmountFromRpc` / `BalanceFromRpc` to use it.
- `AmountFromInput` / `BalanceFromInput` now accept `0x`-prefixed hex (matches existing byte-field behavior). Bare hex without `0x` is still rejected — tracked as a follow-up.
- Document `*FromRpc` rationale (kept solely for the AllSet cross-sign service).
- Remove orphaned `JsonRpcError` and `ProxyErrorData.RpcError` (verified zero production consumers).
