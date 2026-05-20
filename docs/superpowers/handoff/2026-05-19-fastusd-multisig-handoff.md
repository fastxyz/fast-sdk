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
- Base: branched from `0783491` (the old `develop` base before fastUSD existed). **28 commits behind `feat/cli-fund-fastusd`** and 5 commits behind those new `develop` commits. Must be rebased onto fastusd (or, after #87 lands, onto `develop`).
- Scope: 38 commits across `@fastxyz/sdk` (new `MultiSigSigner`, `deriveMultiSigAddress`, `assertAuthorizedSigner`, tagged errors) and `@fastxyz/cli` (`accounts` table migrated to tagged union; `signer-resolver` service; `multisig {init,import,export,pending,vote}`; polymorphic `send`; `token {create,mint,burn,manage}`; six new tagged errors).
- Spec: [`docs/superpowers/specs/2026-05-04-multisig-in-fast-cli-design.md`](../specs/2026-05-04-multisig-in-fast-cli-design.md)
- Plans: [`docs/superpowers/plans/2026-05-04-multisig-cli-phase-1.md`](../plans/2026-05-04-multisig-cli-phase-1.md) (backbone), [`docs/superpowers/plans/2026-05-05-multisig-cli-phase-2-token-ops.md`](../plans/2026-05-05-multisig-cli-phase-2-token-ops.md) (token ops).

### Remaining — multisig

- Rebase onto fastusd (see conflict table below), re-run the full test/build matrix.
- **23 unaddressed Copilot inline comments** from the round-1 review pass — none looked at by Codex or Claude yet, so a fresh round-1 request to those is also pending.
- Three testnet smoke tests from the PR description (2-of-3 init → send → vote → success; `token create` admin assignment; `token manage` `updateId` accept/reject).
- "Out of scope (deferred)" list in the PR body — review which are likely review-blockers (e.g. SDK `MultiSigConfigInvalidError` colliding with the CLI's same `_tag`) vs. real follow-ups.

### Conflict zone — multisig rebase onto fastusd

Both branches diverged from the same base (`0783491`). The high-level picture: only **one file is genuinely hard** — `send.ts`, where both branches rewrite the same handler and the merged result has to thread the fastUSD default-token logic through the multisig dispatch. A second file — `fund/crypto.ts` — is a **rename collision** the rebase will probably mishandle, and the single-signer guard the multisig branch added needs to be manually re-applied at the new path. Everything else is either same-content additions (`package.json`, `vitest.config.ts`) or large-but-region-disjoint edits (`cli.ts`, `main.ts`, `commands/index.ts`) that should merge with mechanical hunk-by-hunk attention. Multisig-only territory — the `accounts` tagged-union migration, the drizzle migration `0001_bumpy_komodo.sql`, and the new `MultiSigSigner` SDK code — does not intersect fastUSD at all.

The table is the detail beneath that summary; line counts are from `git diff --stat` against the shared base.

| File | fastUSD touches | multisig touches | Conflict shape |
| --- | --- | --- | --- |
| `app/cli/src/commands/send.ts` | 13 LOC — new `selectSendTokenName(explicit, networkConfig, chain)` helper called from the Fast→Fast path; mainnet defaults to `fastUSD`. | 230 LOC — polymorphic dispatch on `AccountInfo.kind` (`single` vs `multisig`); `--as <member>` plumbing; multisig signing flow. | **Hard.** Both rewrite the same handler. Merged result must thread the fastUSD default-token selection through *both* the single-signer and multisig paths so mainnet Fast→Fast multisig sends also default to fastUSD. Decide explicitly whether `--as` interacts with default-token resolution. |
| `app/cli/src/commands/pay.ts` | 11 LOC — uses `labelAssetForPayment(network, p.asset)` for dry-run output and history `tokenName`. | 11 LOC — restricts `pay` to single-signer accounts (multisig refusal). | Likely conflict in import block + early-guard region. Mergeable; apply the multisig guard *before* the asset-label call. |
| `app/cli/src/commands/fund/crypto.ts` → `fund/usdc/crypto.ts` | **File moved + renamed** by fastusd (also bumped discriminant string). | 10 LOC — added single-signer guard. | **Rename collision.** `git rebase` will likely drop the multisig change. Re-apply the single-signer guard at the new path `fund/usdc/crypto.ts` after the rename is resolved. |
| `app/cli/src/cli.ts` | 45 LOC — `fundGroup → or(fundUsdcGroup, fundFastUsdParser)`; `fundUsdcGroup → or(fiat, crypto)`. | 287 LOC — multisig + token parser trees; `send` gains `--as`. | Big diffs but **largely disjoint regions** (fund tree vs. multisig/token subtrees). Watch the top-of-file imports and the root `or(...)` combinator. |
| `app/cli/src/main.ts` | 39 LOC — `SUBCOMMANDS["fund"]` becomes `["usdc", "fastusd"]`; rekeyed `SUBCOMMAND_REQUIREMENTS`; parse-error post-processing extended to try a 3-deep key before 2-deep fallback. | 171 LOC — multisig + token command validation, help text, hint extensions. | Disjoint regions; mergeable. Watch any shared dictionaries (SUBCOMMANDS / help registries) for ordering. |
| `app/cli/src/commands/index.ts` | 10 LOC — fund handlers re-registered under new discriminants. | 17 LOC — multisig + token handlers registered. | Mergeable; both append to the same registry. |
| `app/cli/package.json` | +1 line — `"test": "vitest run"` + vitest devDeps. | +1 line — identical addition. | **Trivial.** PR #87 description explicitly flags this as a known same-content collision. |
| `app/cli/vitest.config.ts` | 7 LOC — new file. | 7 LOC — identical new file. | Trivial — same content on both sides. |
| `app/cli/src/schemas/networks.ts` | 12 LOC — optional `fastTokens` map. | (untouched) | No conflict. |
| `app/cli/src/services/token-resolver.ts` | 124 LOC — `resolveDefaultToken`, `lookupTokenNameById`, fastTokens-aware `resolveToken`. | (untouched) | No conflict. |

**Non-overlap to note:** the multisig `accounts` tagged-union migration (`app/cli/src/db/schema.ts`, `services/storage/account.ts`, drizzle migration `0001_bumpy_komodo.sql`) is entirely on the multisig side. fastUSD doesn't touch `accounts`, the DB schema, or any drizzle migration. Likewise, multisig's `MultiSigSigner` SDK work in `packages/fast-sdk/src/interface/multisig-signer.ts` is net-new — no fastUSD overlap there.

After the rebase, the regression net is: CLI `pnpm exec vitest run` (~31 fastusd cases + ~23 multisig cases), SDK `pnpm exec vitest run` (~14 multisig cases), `pnpm exec tsc --noEmit` on `app/cli`, `packages/x402-client`, `packages/fast-sdk`, then `pnpm build`.

## Pointers

- PRs: [#87](https://github.com/fastxyz/fast-sdk/pull/87) (fastUSD), [#85](https://github.com/fastxyz/fast-sdk/pull/85) (multisig)
- Specs: [`docs/superpowers/specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md`](../specs/2026-05-06-cli-fund-restructure-and-fastusd-design.md), [`docs/superpowers/specs/2026-05-04-multisig-in-fast-cli-design.md`](../specs/2026-05-04-multisig-in-fast-cli-design.md)
- Plans: [`docs/superpowers/plans/2026-05-06-cli-fund-restructure-and-fastusd.md`](../plans/2026-05-06-cli-fund-restructure-and-fastusd.md), [`docs/superpowers/plans/2026-05-04-multisig-cli-phase-1.md`](../plans/2026-05-04-multisig-cli-phase-1.md), [`docs/superpowers/plans/2026-05-05-multisig-cli-phase-2-token-ops.md`](../plans/2026-05-05-multisig-cli-phase-2-token-ops.md)
