---
"@fastxyz/schema": major
"@fastxyz/sdk": major
"@fastxyz/x402-client": patch
"@fastxyz/x402-facilitator": patch
"@fastxyz/allset-sdk": patch
"@fastxyz/cli": patch
---

Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
Fixed x402 serialization format handling for Effect Schema decoded transactions.
Updated x402-facilitator with version-agnostic BCS handling and format variant support.
Internal dependency updates for allset-sdk.
