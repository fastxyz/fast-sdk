# Releasing Fast SDK

This monorepo publishes `@fastxyz/*` packages to npm. Releases are managed with [Changesets](https://github.com/changesets/changesets) and automated via GitHub Actions.

## One-time npm setup

1. Create or verify access to the `@fastxyz` npm scope.
2. Configure npm trusted publishing (OIDC) for `fastxyz/fast-sdk`.
3. Register the publish workflow filename exactly as `.github/workflows/publish.yml`.

Trusted publishing is the expected path for this repo. Do not add a long-lived npm token.

## Packages published

| Package | Path |
|---|---|
| `@fastxyz/schema` | `packages/fast-schema/` |
| `@fastxyz/sdk` | `packages/fast-sdk/` |

> Other packages (`allset-sdk`, `x402-*`, `cli`) are excluded from automated versioning via `.changeset/config.json` `ignore` list.

## Day-to-day: recording changes

After each meaningful change, create a changeset:

```bash
pnpm pub:changeset
```

Commit the generated `.changeset/*.md` file alongside your code changes.

## Stable release flow

Stable releases are published from the `main` branch automatically.

```
1. Merge feature branch to main (with changeset files)
2. CI creates a "Version Packages" PR (bumps versions + updates CHANGELOG)
3. Review and merge the Version PR
4. CI automatically publishes to npm @latest
```

### Manual steps:

```bash
# 1. Add changeset (if not already done)
pnpm pub:changeset

# 2. Merge to main and let CI handle the rest
git checkout main && git merge feature-branch
git push
```

## Pre-release flow (testnet)

Pre-releases are versioned via `version.yml` and published via `publish.yml`, both on `release/*` branches.

```
1. Create release branch and enter testnet pre-release mode
2. Add changeset + push
3. version.yml creates a Version PR (bumps to 2.0.0-testnet.0)
4. Merge the Version PR
5. publish.yml publishes to npm @testnet
6. Repeat for subsequent pre-release iterations
```

### Manual steps:

```bash
# 1. Create release branch
git checkout -b release/testnet

# 2. Enter pre-release mode
pnpm pub:testnet

# 3. Add changeset (if not already done)
pnpm pub:changeset

# 4. Commit and push
git add -A && git commit -m "chore: enter testnet pre-release"
git push -u origin release/testnet

# 5. version.yml creates Version PR → merge it → publish.yml publishes

# 6. For subsequent iterations, add more changesets and push
```

### Graduating from pre-release to stable:

```bash
# 1. Exit pre-release mode on the release branch
pnpm pub:exit-pre
git add -A && git commit -m "chore: exit pre-release mode"

# 2. Merge release branch to main
git checkout main && git merge release/testnet
git push

# 3. CI creates Version PR (stable versions) → merge → CI publishes @latest
```

> ⚠️ **Important:** Always run `pnpm pub:exit-pre` before merging to main. The publish workflow will fail if `pre.json` is detected on the main branch.

## Available npm scripts

| Script | Command | Description |
|---|---|---|
| `pub:changeset` | `pnpm changeset` | Create a new changeset |
| `pub:testnet` | `changeset pre enter testnet` | Enter testnet pre-release mode |
| `pub:exit-pre` | `changeset pre exit` | Exit pre-release mode |
| `pub:version` | `changeset version` | Bump versions locally |
| `pub:release` | `build + changeset publish` | Manual local publish (rarely needed) |

## CI workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `version.yml` | push to `main` | Create Version PR (stable versioning) |
| `version.yml` | push to `release/*` | Create Version PR (pre-release versioning) |
| `publish.yml` | push to `main` or `release/*` | Publish to npm (only when no pending changesets) |

**How it works:**

1. You push code with a changeset file → `version.yml` creates a Version PR (bumps versions + updates CHANGELOG)
2. You merge the Version PR → `publish.yml` detects no pending changesets → builds, tests, publishes to npm

`version.yml` uses `changesets/action@v1` for automated Version PR creation. It also includes a pre-release guard on main: if `.changeset/pre.json` exists, the workflow fails to prevent accidental pre-release publishing from main.

`publish.yml` uses OIDC `id-token` for npm authentication (no secrets needed) and publishes with `--provenance --access public`.

## Release invariants

- Only packages with a version bump are published; unchanged packages are skipped.
- Do not manually edit package versions — always use `pnpm pub:changeset` + CI automation.
- All packages publish with `--access public` (configured in `.changeset/config.json`).
- Never use `git push --force`.

## Entrypoint policy

- Each package's `src/index.ts` is the single public entrypoint.
- Ensure docs and examples do not reference internal paths.
