# Releasing Fast SDK

This repo publishes `@fastxyz/sdk` to npm from Git tags.

## One-time npm setup

1. Create or verify access to the `@fastxyz` npm scope.
2. Configure npm trusted publishing for `fastxyz/fast-sdk`.
3. Register the publish workflow filename exactly as `.github/workflows/publish.yml`.

Trusted publishing is the expected path for this repo. Do not add a long-lived npm token unless trusted publishing is unavailable.

## Release flow

1. Update `package.json` with the next semver version.
2. Run `npm install` if the lockfile needs refreshing.
3. Merge the release commit to `main`.
4. Create and push a matching tag in the form `vX.Y.Z`.
5. Wait for the publish workflow to finish.
6. Verify the package on npm and test a fresh install with `npm install @fastxyz/sdk`.

## Release invariants

- The git tag must match `package.json` exactly.
- The publish workflow rebuilds, tests, runs package smoke checks, and publishes only on tag pushes.
- Public scoped packages must publish with public access.

## Minimal SDK migration checklist

Use this checklist for releases that contract the public surface to the minimal SDK model.

1. Confirm README documents only the current supported APIs.
2. Confirm removed APIs are listed in a migration section.
3. Confirm provider docs show strict RPC 1:1 mapping.
4. Confirm examples use `FastProvider` + `Signer` flow (no wallet/keyfile helpers).
5. Confirm `npm run build` and `npm test` pass on the release commit.

## Entrypoint policy

- Keep `@fastxyz/sdk` as the single public runtime entrypoint.
- Keep `@fastxyz/sdk/core` for helper-only integrations.
- Ensure docs and examples do not reference deprecated split entrypoints.
