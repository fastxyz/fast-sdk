# Land PR #87 (fastUSD) — minimal plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge PR [#87](https://github.com/fastxyz/fast-sdk/pull/87) (`feat/cli-fund-fastusd` → `develop`) **as-is** after a fast-forward-clean rebase onto current `develop`. No new code, no scope additions.

**Architecture:** Branch is `MERGEABLE`, CI green on tip `fac12a2`. It is 5 commits behind `origin/develop` (HEAD `00635d3`). The 5 develop-only commits touch only `.npmrc`, `pnpm-workspace.yaml`, `packages/fast-sdk/src/wallet/**`, and `packages/fast-sdk/tests/unit/wallet-*.test.ts` — entirely orthogonal to fastUSD's surface area. Rebase is fast-forward-clean. This plan is hygiene + merge only.

**Tech Stack:** Git rebase, pnpm + Turbo for the regression net, `gh` for the merge.

**Out of scope (handled by a separate follow-up PR):**
- The fail-loud guard for default `fastUSD` on bridge routes (`fund usdc crypto`, bridge-mode `send`, `pay`). Tracked in PR [#96](https://github.com/fastxyz/fast-sdk/pull/96) handoff and as Yuqing's comment on PR #87. **Needs its own brainstorming → spec → plan → PR**, not bundled here.
- Round-1 Copilot inline #3 (hardcoded `decimals=6` in `packages/x402-client/src/fast.ts:141`). Also a follow-up — same PR as fail-loud, or its own; decide during the follow-up brainstorm.
- The remaining unchecked smoke tests in PR #87's description. They validate behavior that is already in the branch and CI-green; they can be run during/after merge, not as a blocker.

---

## Task 0: Pre-flight

**Read-only verification that the world matches this plan's assumptions.**

- [ ] **Step 1: Verify PR #87 is still open, mergeable, and CI is green**

Run: `gh pr view 87 --repo fastxyz/fast-sdk --json state,mergeable,mergeStateStatus,statusCheckRollup --jq '{state, mergeable, mergeStateStatus, checks: [.statusCheckRollup[] | {name, conclusion}]}'`

Expected: `state: OPEN`, `mergeable: MERGEABLE`, both `test (20)` and `test (22)` are `SUCCESS`. If any of these differ, STOP and re-assess — the rest of the plan assumes the branch is ready to land.

- [ ] **Step 2: Verify the develop-only commits touch only orthogonal files**

Run:
```bash
git fetch origin develop feat/cli-fund-fastusd
git log --oneline origin/feat/cli-fund-fastusd..origin/develop
git diff --name-only origin/feat/cli-fund-fastusd...origin/develop \
  | grep -vE '^(\.npmrc|pnpm-workspace\.yaml|packages/fast-sdk/(package\.json|src/wallet/.*|tests/unit/wallet-.*))$' \
  || echo "OK — only orthogonal files"
```

Expected: 5 commits ahead, final line prints `OK — only orthogonal files`. If anything else appears, the "fast-forward-clean" assumption is wrong; the rebase needs conflict planning before continuing.

- [ ] **Step 3: No commit — verification only.**

---

## Task 1: Rebase, push, merge

- [ ] **Step 1: Create a working branch from the PR head**

```bash
git switch -c land/pr-87 origin/feat/cli-fund-fastusd
git status
```

Expected: clean working tree on the new branch.

- [ ] **Step 2: Rebase onto develop**

```bash
git rebase origin/develop
```

Expected: `Successfully rebased and updated refs/heads/land/pr-87.` No conflict markers. If a conflict appears in any file outside the orthogonal set, STOP and re-assess.

- [ ] **Step 3: Sanity-check the rebase is content-equivalent**

```bash
git log --oneline land/pr-87 ^origin/develop | wc -l
git diff origin/feat/cli-fund-fastusd..land/pr-87 -- app/cli/ packages/x402-client/ skills/ docs/ README.md SPEC.md
```

Expected: first command prints `26`; second command produces empty output (no semantic content changed — only the merge base moved).

- [ ] **Step 4: Run the regression net on the rebased branch**

```bash
pnpm install --frozen-lockfile
pnpm --filter @fastxyz/cli exec vitest run
pnpm --filter @fastxyz/x402-client exec vitest run
pnpm --filter @fastxyz/cli exec tsc --noEmit
pnpm --filter @fastxyz/x402-client exec tsc --noEmit
pnpm --filter @fastxyz/sdk exec tsc --noEmit
pnpm exec turbo run build
```

Expected: CLI 31 pass (4 files), x402-client 20 pass, all tsc clean, `turbo run build` green. If anything regresses, the rebase pulled in an unexpected interaction with the wallet code from PR #94 — diagnose before pushing.

- [ ] **Step 5: Force-push the rebased branch back to `feat/cli-fund-fastusd`**

```bash
git push --force-with-lease origin land/pr-87:feat/cli-fund-fastusd
```

`--force-with-lease` (not `--force`) ensures we abort if someone else pushed to the remote branch in the meantime. PR #87 updates automatically to the new head, CI re-runs.

- [ ] **Step 6: Wait for CI green on the new head**

```bash
gh pr checks 87 --watch --repo fastxyz/fast-sdk
```

Expected: both jobs finish `SUCCESS`. If anything regresses on CI but passed locally, diagnose before merging.

- [ ] **Step 7: Merge PR #87**

Check the repo's merge convention with `git log origin/develop --merges -5` first. Current convention is true merges (see `2da9260 Merge pull request #95 …`). Match that style:

```bash
gh pr merge 87 --repo fastxyz/fast-sdk --merge
```

Expected: PR transitions to MERGED state.

- [ ] **Step 8: Verify the merge landed on develop**

```bash
git fetch origin develop
git log --oneline origin/develop -5
```

Expected: the merge commit (or the squashed/rebased commits) appear at the tip of `origin/develop`.

- [ ] **Step 9: Clean up local branch**

```bash
git checkout main
git branch -D land/pr-87
```

(Leave the remote `feat/cli-fund-fastusd` alone — GitHub may auto-delete it on merge depending on repo settings.)

---

## Risk register

1. **Rebase surprise.** Task 0 Step 2 verifies the orthogonal file set. If Task 1 Step 2's `git rebase` reports conflicts, STOP — the assumption broke. Investigate before continuing.
2. **CI flake post-rebase.** Local tests pass on the rebased branch but CI may interact differently with the new wallet code (from PR #94) now in the merge base. If a wallet-related test fails on CI but not locally, that's the interaction — diagnose before merging.
3. **Merge convention drift.** Verify the repo's current merge convention before merging (Task 1 Step 7). It is currently true merges; if a maintainer changed it to squash/rebase, use the matching `gh pr merge` flag.

---

## Follow-up (separate workstream, NEW session)

After this plan lands, open a **new brainstorming/spec/planning session** for:

- **Fail-loud default-token on bridge routes.** Principle (from PR #96 handoff): default is `fastUSD` everywhere, or `--token` is an explicit choice — never a silent route-dependent substitution. Today, `fund usdc crypto` and bridge-mode `send` silently fall through to the chain's first token (USDC on mainnet) when `--token` is omitted. Decide the right shape (new error type? guard helper? signature change to `selectSendTokenName`?), then write spec + plan + PR.
- Bundled into that PR or its own: the unresolved Copilot inline #3 (hardcoded `decimals=6` in `packages/x402-client/src/fast.ts:141`).

That session starts with brainstorming, not coding.
