# @fastxyz/schema

## 2.0.0-testnet.0

### Major Changes

- Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.

## 1.1.0

### Minor Changes

- Add Release20260407 transaction version with versioned factory pattern, escrow BCS types and operation variant, REST palette with canonical domain type aliases, and LatestTransactionVersion constant. makeTransaction() now aliases to Release20260407.
