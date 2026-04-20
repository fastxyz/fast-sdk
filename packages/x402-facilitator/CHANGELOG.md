# @fastxyz/x402-facilitator

## 1.0.3-testnet.0

### Patch Changes

- 6b184ec: Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
  Fixed x402 serialization format handling for Effect Schema decoded transactions.
  Updated x402-facilitator with version-agnostic BCS handling and format variant support.
  Internal dependency updates for allset-sdk.
- Updated dependencies [6b184ec]
  - @fastxyz/schema@2.0.0-testnet.0
  - @fastxyz/sdk@2.0.0-testnet.0

## 1.0.2

### Patch Changes

- 614b96c: Fix serialization format handling for Effect Schema decoded transactions
  - **x402-client**: Replace manual `toBcsFormat()` with `Schema.encodeSync(VersionedTransactionFromBcs)` for correct BCS hash computation. Adds `effect` as a direct dependency.
  - **x402-facilitator**: Fix `toBcsFormat()` to convert decimal string bigints from JSON roundtrip. Fix `extractSenderSignature()` and `hasMultiSig()` to handle typed variant format (`{type, value}`) in addition to keyed variant format.
