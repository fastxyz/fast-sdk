---
"@fastxyz/x402-client": patch
"@fastxyz/x402-facilitator": patch
---

Fix serialization format handling for Effect Schema decoded transactions

- **x402-client**: Replace manual `toBcsFormat()` with `Schema.encodeSync(VersionedTransactionFromBcs)` for correct BCS hash computation. Adds `effect` as a direct dependency.
- **x402-facilitator**: Fix `toBcsFormat()` to convert decimal string bigints from JSON roundtrip. Fix `extractSenderSignature()` and `hasMultiSig()` to handle typed variant format (`{type, value}`) in addition to keyed variant format.
