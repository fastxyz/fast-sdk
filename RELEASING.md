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

Stable releases are published from the `main` branch.

```
1. Merge feature/develop to main (with changeset files)
2. version.yml creates a "Version Packages" PR (bumps versions + updates CHANGELOG)
3. Review and merge the Version PR
4. publish.yml detects no pending changesets → builds, tests, publishes to npm @latest
```

## Pre-release flow (testnet)

Pre-releases use `pre-release/*` branches. These branches are disposable and never merged to main.

```
1. Create pre-release branch from develop (or main)
2. Enter testnet pre-release mode + push
3. version.yml creates a Version PR (bumps to e.g. 2.0.0-testnet.0)
4. Merge the Version PR
5. publish.yml publishes to npm @testnet
6. Repeat steps 2-5 for subsequent iterations
```

### Manual steps:

```bash
# 1. Create pre-release branch
git checkout develop
git checkout -b pre-release/testnet

# 2. Enter pre-release mode
pnpm pub:testnet

# 3. Add changeset (if not already present)
pnpm pub:changeset

# 4. Commit and push
git add -A && git commit -m "chore: enter testnet pre-release"
git push -u origin pre-release/testnet

# 5. version.yml creates Version PR → merge it → publish.yml publishes @testnet
```

### Graduating to stable release:

Pre-release branches are **not** merged to main. Instead:

```bash
# 1. Pre-release testing is done — go back to develop/main
# 2. Merge develop (or feature branch) to main
#    The original changeset files are still on main/develop
#    (they were only consumed on the pre-release branch)
# 3. version.yml creates Version PR (stable versions) → merge → publish.yml publishes @latest
# 4. Delete the pre-release branch
git push origin --delete pre-release/testnet
```

## Available npm scripts

| Script | Command | Description |
|---|---|---|
| `pub:changeset` | `pnpm changeset` | Create a new changeset |
| `pub:testnet` | `changeset pre enter testnet` | Enter testnet pre-release mode |
| `pub:version` | `changeset version` | Bump versions locally |
| `pub:release` | `build + changeset publish` | Manual local publish (rarely needed) |

## CI workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `version.yml` | push to `main` | Create Version PR (stable versioning) |
| `version.yml` | push to `pre-release/*` | Create Version PR (pre-release versioning) |
| `publish.yml` | push to `main` or `pre-release/*` | Publish to npm (only when no pending changesets) |

**How it works:**

1. You push code with a changeset file → `version.yml` creates a Version PR
2. You merge the Version PR → `publish.yml` detects no pending changesets → builds, tests, publishes

`version.yml` includes a pre-release guard on main: if `.changeset/pre.json` exists, the workflow fails.

`publish.yml` uses OIDC `id-token` for npm authentication (no secrets needed) and publishes with `--provenance --access public`.

## Release invariants

- Only packages with a version bump are published; unchanged packages are skipped.
- Do not manually edit package versions — always use `pnpm pub:changeset` + CI automation.
- All packages publish with `--access public` (configured in `.changeset/config.json`).
- `pre-release/*` branches are never merged to main — they are disposable.
- Never use `git push --force`.

## Entrypoint policy

- Each package's `src/index.ts` is the single public entrypoint.
- Ensure docs and examples do not reference internal paths.
