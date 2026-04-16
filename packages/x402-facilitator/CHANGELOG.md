# @fastxyz/x402-facilitator

## 1.0.2

### Patch Changes

- 614b96c: Fix serialization format handling for Effect Schema decoded transactions
  - **x402-client**: Replace manual `toBcsFormat()` with `Schema.encodeSync(VersionedTransactionFromBcs)` for correct BCS hash computation. Adds `effect` as a direct dependency.
  - **x402-facilitator**: Fix `toBcsFormat()` to convert decimal string bigints from JSON roundtrip. Fix `extractSenderSignature()` and `hasMultiSig()` to handle typed variant format (`{type, value}`) in addition to keyed variant format.
