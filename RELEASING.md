# Releasing Fast SDK

This monorepo publishes multiple `@fastxyz/*` packages to npm. Releases are managed with [Changesets](https://github.com/changesets/changesets) and triggered by creating a GitHub Release.

## One-time npm setup

1. Create or verify access to the `@fastxyz` npm scope.
2. Configure npm trusted publishing for `fastxyz/fast-sdk`.
3. Register the publish workflow filename exactly as `.github/workflows/publish.yml`.

Trusted publishing is the expected path for this repo. Do not add a long-lived npm token unless trusted publishing is unavailable.

## Packages published

| Package | Path |
|---|---|
| `@fastxyz/sdk` | `packages/fast-sdk/` |
| `@fastxyz/allset-sdk` | `packages/allset-sdk/` |
| `@fastxyz/x402-client` | `packages/x402-client/` |
| `@fastxyz/x402-server` | `packages/x402-server/` |
| `@fastxyz/x402-facilitator` | `packages/x402-facilitator/` |
| `@fastxyz/fast-cli` | `app/cli/` |
| `@fastxyz/fast-schema` | `packages/fast-schema/` |
| `@fastxyz/x402-types` | `packages/x402-types/` |

## Day-to-day: recording changes

After each meaningful change, create a changeset:

```bash
pnpm changeset
```

Commit the generated `.changeset/*.md` file alongside your code changes.

## Release flow

1. **Bump versions** — run `pnpm version-packages`, commit and push
2. **Create a GitHub Release** — GitHub → Releases → "Draft a new release" → Publish
3. **Wait for publish workflow** — builds, tests, and publishes only the changed packages
4. **Verify** — check each updated package on npm

## Release invariants

- Only packages with a version bump are published; unchanged packages are skipped.
- Do not manually edit package versions — always use `pnpm changeset` + `pnpm version-packages`.
- All packages publish with `--access public` (configured in `.changeset/config.json`).

## Entrypoint policy

- Each package's `src/index.ts` is the single public entrypoint.
- Ensure docs and examples do not reference internal paths.
