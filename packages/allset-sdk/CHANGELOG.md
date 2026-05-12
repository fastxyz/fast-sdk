# @fastxyz/allset-sdk

## 1.0.3

### Patch Changes

- Updated dependencies [f4ce27c]
- Updated dependencies [c01ec1e]
  - @fastxyz/sdk@2.1.0

## 1.0.2

### Patch Changes

- 6b184ec: Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
  Fixed x402 serialization format handling for Effect Schema decoded transactions.
  Updated x402-facilitator with version-agnostic BCS handling and format variant support.
  Internal dependency updates for allset-sdk.
- Updated dependencies [6b184ec]
  - @fastxyz/schema@2.0.0
  - @fastxyz/sdk@2.0.0
