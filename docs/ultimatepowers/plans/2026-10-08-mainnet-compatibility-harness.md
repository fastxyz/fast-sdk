# Mainnet Compatibility Harness Implementation Plan

> Execute inline using executing-plans and test-driven-development; preserve the existing isolated PR worktree. No spending is authorized by this maintenance task.

**Goal:** Align PR #187 with the completed FAST mainnet/Base experiments without changing production verification.

**Architecture:** Retarget existing configuration and both harness suites. Preserve the matrix gate and add explicit mainnet acknowledgement. Store public historical evidence separately from current-head verification.

**Tech Stack:** TypeScript, Vitest, FAST SDK, viem, Express.

## Task 1 — Configuration safety

- [x] Change tests/live-config.test.ts to use mainnet.url, FAST_MAINNET_* and BASE_* inputs, require X402_MAINNET_SPENDING=1, reject the old endpoint and reject sharing the payer with recipient/facilitator.
- [x] Run `pnpm --filter @fastxyz/x402-e2e test`; observe the mainnet configuration tests fail against the old configuration (seven failures).
- [x] In src/live-config.ts require the acknowledgement before credentials, pin mainnet.url, require HTTPS BASE_RPC_URL and normalize the new key names. Preserve positive gas budget and controlled-recipient checks.
- [x] Rerun offline tests (ten pass) and `pnpm --filter @fastxyz/x402-e2e build`.

## Task 2 — Mainnet matrix and standalone

- [x] Update matrix imports to mainnet/base, select fast-mainnet/base, native Base USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, chain 8453 and USD Coin/version 2.
- [x] Preserve the single payment call and use receipt.blockNumber for Base recipient-credit confirmation; retain all FAST confirmation checks and explicitly assert at least three fetched signatures.
- [x] Retarget standalone Fast suite to mainnet and require explicit mainnet-spending acknowledgement without making it a release gate.
- [x] Test mainnet endpoint/configuration assertions offline; invoke live command without opt-in (eight skips) and gate without opt-in (nonzero expected). Never provide live keys.

## Task 3 — Evidence and delivery

- [x] Update README and formal harness amendment to the approved mainnet domain. Add docs/x402/mainnet-compatibility-evidence.md containing the exact original candidate, eight public hashes, headers, reconciliation distinctions and package hashes.
- [x] Run diff whitespace check, e2e typecheck, offline suites and runtime regression suites (client 79, server 37, facilitator 83); confirm no production verifier diff.
- [ ] Commit only the scoped harness/docs files, push the existing PR branch normally and update #187 title/body. Do not merge or publish.
