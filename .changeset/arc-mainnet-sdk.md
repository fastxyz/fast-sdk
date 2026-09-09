---
"@fastxyz/allset-sdk": minor
---

Add Arc mainnet (chain 5042) to `CHAIN_MAP` via a `defineChain` export `arc`, so `createEvmExecutor(account, rpcUrl, 5042)` resolves without a caller-supplied Chain object.
