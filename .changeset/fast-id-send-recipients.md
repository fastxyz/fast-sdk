---
"@fastxyz/cli": minor
"@fastxyz/fastid-sdk": minor
---

`fast send` accepts Fast ID names (e.g. `alice.smith`) as recipients. The CLI resolves the name on the current network (mainnet or testnet) before signing, shows `alice.smith (fast1…)` in the confirmation and adds `toName` to `--json` output. Resolution fails closed: unregistered names exit with `INVALID_ADDRESS`, registry errors with `FAST_ID_RESOLUTION_FAILED`, and nothing is sent. Names are rejected with `--to-chain`. `@fastxyz/fastid-sdk` adds `IdReader`, a signer-free client for public identity reads, and exports `isCanonicalName`. Closes #163.
