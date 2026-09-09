# Handoff — fastUSD (PR #87) + multisig CLI (PR #85)

**Date:** 2026-05-19
**From:** Yuqing
**To:** TBD

Two open PRs need to land on `develop`, in this order: **PR #87 (fastUSD) first, then PR #85 (multisig) rebased on top**. This doc captures branch state, what's left, and the concrete conflict surface for the multisig rebase. Rebase mechanics are standard `git rebase --onto`; this doc does not prescribe them.

## PR #87 — `feat(cli): fund command restructure + fastUSD adoption`

- Branch: [`feat/cli-fund-fastusd`](https://github.com/fastxyz/fast-sdk/tree/feat/cli-fund-fastusd) · PR: [#87](https://github.com/fastxyz/fast-sdk/pull/87)
- Base: branched from old `develop` tip `95dc796`; **5 commits behind** current `origin/develop` (`00635d3`). The 5 new commits (wallet popup module + npm/pnpm install safeguards) touch only `.npmrc`, `pnpm-workspace.yaml`, `packages/fast-sdk/{package.json,src/wallet/**,tests/unit/wallet-*.test.ts}` — **no overlap** with this branch. Rebase is fast-forward-clean.
- Scope: 26 commits. CLI `fund` restructured into a 2-deep tree (`fund usdc fiat`, `fund usdc crypto`, new `fund fastusd`); mainnet Fast→Fast `send` defaults to fastUSD; x402-client surfaces the real paid asset so dry-run/log/history stop mislabeling as `USDC`.
- Spec: [`docs/superpowers/specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md`](../specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md)
- Plan: [`docs/superpowers/plans/2026-05-06-cli-fund-restructure-and-fastusd.md`](../plans/2026-05-06-cli-fund-restructure-and-fastusd.md)

### Remaining — fastUSD

- **Round-2 review.** Round-1 review left ~10 findings across Codex, Claude, and Copilot. The last ~6 commits on the branch address them (EVM asset id surfaced on `PaymentDetails`; non-throwing default-token selection in `send` path; Ramp URL hardened with `URLSearchParams` + real Fast-address validation; `fastUSDC` dropped as a `--token` value; docs reworded for route-specific defaults). A reviewer pass is needed to confirm each finding is closed.
- **Two unchecked smoke tests** (from the PR description):
  - mainnet: open the emitted `fund fastusd` URL once the unified Fast web app is live; confirm `to=` is recognized and `amount=` pre-fills.
  - testnet: `fast send fast1addr 5` (no `--token`) defaults to `testUSDC`; mainnet equivalent defaults to `fastUSD`.
- **Fail loud on routes the default `fastUSD` can't serve.** Default is `fastUSD` on mainnet, but some routes (e.g. `fund usdc crypto`, which goes through allSet) can't settle in fastUSD. When `--token` is omitted on one of those routes, do not silently substitute a different default (e.g. fall through to `fastUSDC` or the chain's bridge token). Instead, print an error explaining that the default `fastUSD` is not supported on this command and instructing the user to pass `--token USDC` explicitly. The principle: default is fastUSD everywhere or it's an explicit choice — never a silent route-dependent substitution.

## PR #85 — `feat(cli): multisig support — N-of-M wallets + token operations`

- Branch: [`feat/multisig-cli`](https://github.com/fastxyz/fast-sdk/tree/feat/multisig-cli) · PR: [#85](https://github.com/fastxyz/fast-sdk/pull/85)
- Status as of 2026-05-21: **rebased onto latest `origin/develop` and force-pushed**. New PR head is `2b1268d` (`fix(cli): declare viem type dependency`); `origin/develop` at rebase time was `28ceed9`.
- Scope: 39 commits after rebase: the original multisig/token-ops work plus one follow-up dependency fix for the CLI's direct `viem` type import. The feature still spans `@fastxyz/sdk` (new `MultiSigSigner`, `deriveMultiSigAddress`, `assertAuthorizedSigner`, tagged errors) and `@fastxyz/cli` (`accounts` table migrated to tagged union; `signer-resolver` service; `multisig {init,import,export,pending,vote}`; polymorphic `send`; `token {create,mint,burn,manage}`; six new tagged errors).
- Verification completed after rebase:
  - `pnpm -C app/cli exec tsc --noEmit`
  - `pnpm -C app/cli exec vitest run` -- 77 tests passed.
  - `pnpm -C packages/fast-sdk exec vitest run tests/unit/multisig-signer.test.ts` -- 14 tests passed.
  - `pnpm build` -- 9/9 tasks successful.
  - GitHub CI on #85 is green for the two reported `test` check runs.
- Spec: [`docs/superpowers/specs/2026-05-04-multisig-in-fast-cli-design.md`](../specs/2026-05-04-multisig-in-fast-cli-design.md)
- Plans: [`docs/superpowers/plans/2026-05-04-multisig-cli-phase-1.md`](../plans/2026-05-04-multisig-cli-phase-1.md) (backbone), [`docs/superpowers/plans/2026-05-05-multisig-cli-phase-2-token-ops.md`](../plans/2026-05-05-multisig-cli-phase-2-token-ops.md) (token ops).

### Remaining — multisig

- **Review old Copilot comments.** The existing Copilot round-1 review was generated against old head `d7e03a1` and reported 23 inline comments. Triage each comment against new head `2b1268d`: close anything made obsolete by the rebase/#87/#98 integration, and fix anything still valid.
- **Request fresh reviews on the rebased PR.** Ask Codex/Claude/Copilot to review #85 again against `2b1268d`; the old review context predates the fastUSD rebase.
- **Run the three remaining testnet smoke tests from the PR description:**
  - 2-of-3 multisig init -> `send` -> cosigner `vote` -> quorum success.
  - `token create` from single-signer -> admin assignment is correct.
  - `token manage` rejects a wrong `updateId` and accepts the current `updateId`.
- **Audit the deferred/out-of-scope list in the PR body.** Decide which items are merge blockers vs. follow-ups. Pay special attention to the SDK `MultiSigConfigInvalidError` and CLI `MultiSigConfigInvalidError` sharing the same `_tag`; runtime behavior is currently fine because the CLI maps SDK errors, but reviewers may still ask for disambiguation.
- **Resolve branch protection/review blockers.** CI is currently green, so remaining merge blockers should be review approval or repository policy state rather than test failures.

### Rebase/conflict resolution notes — multisig onto develop

Rebase is complete. The actual conflicts matched the expected conflict surface and were resolved on `feat/multisig-cli` before force-pushing #85.

| File/area | Resolution |
| --- | --- |
| `packages/fast-sdk/src/index.ts` | Kept the `FastNetwork` / `FastToken` exports from `develop` and added the multisig SDK public API exports. |
| `app/cli/src/commands/fund/usdc/crypto.ts` | Re-applied the multisig single-signer guard at the post-#87 path and kept #98's default-token fail-loud behavior. The hint now points to `fast fund usdc crypto`. |
| `app/cli/src/commands/send.ts` | Kept `develop`'s default-token resolution/fail-loud path, then dispatches Fast -> Fast sends through the multisig-aware single-vs-multisig flow. `--as` only affects signer/member resolution, not token resolution. |
| `app/cli/src/commands/pay.ts` | Kept the single-signer guard and the real paid-asset labeling/history behavior from the fastUSD/x402 work. |
| `app/cli/src/cli.ts`, `app/cli/src/main.ts`, `app/cli/src/commands/index.ts` | Kept the new `fund usdc` / `fund fastusd` tree and registered all multisig/token parsers, handlers, and validation hints. |
| `app/cli/package.json`, `pnpm-lock.yaml` | Added `viem` as a CLI dev dependency because `app/cli/src/services/api/allset.ts` directly imports `viem` types; this avoids clean-install `tsc` failures under pnpm. |

## Pointers

- PRs: [#87](https://github.com/fastxyz/fast-sdk/pull/87) (fastUSD), [#85](https://github.com/fastxyz/fast-sdk/pull/85) (multisig)
- Specs: [`docs/superpowers/specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md`](../specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md), [`docs/superpowers/specs/2026-05-04-multisig-in-fast-cli-design.md`](../specs/2026-05-04-multisig-in-fast-cli-design.md)
- Plans: [`docs/superpowers/plans/2026-05-06-cli-fund-restructure-and-fastusd.md`](../plans/2026-05-06-cli-fund-restructure-and-fastusd.md), [`docs/superpowers/plans/2026-05-04-multisig-cli-phase-1.md`](../plans/2026-05-04-multisig-cli-phase-1.md), [`docs/superpowers/plans/2026-05-05-multisig-cli-phase-2-token-ops.md`](../plans/2026-05-05-multisig-cli-phase-2-token-ops.md)
