# @fastxyz/fastid-sdk

## 0.2.0

### Minor Changes

- 303da43: `fast send` accepts Fast ID names (e.g. `alice.smith`) as recipients. The CLI resolves the name on the current network (mainnet or testnet) before signing, shows `alice.smith (fast1…)` in the confirmation and adds `toName` to `--json` output. Resolution fails closed: unregistered names exit with `INVALID_ADDRESS`, registry errors with `FAST_ID_RESOLUTION_FAILED`, and nothing is sent. Names are rejected with `--to-chain`. `@fastxyz/fastid-sdk` adds `IdReader`, a signer-free client for public identity reads, and exports `isCanonicalName`. Closes #163.

## 0.1.0

### Minor Changes

- 6ca5eaa: Move the Fast ID client into the public monorepo as @fastxyz/fastid-sdk, preserving
  the client API, recovery contracts and Apache-2.0 license.

### Patch Changes

- Updated dependencies [0333729]
- Updated dependencies [f95e12a]
  - @fastxyz/sdk@2.4.0
