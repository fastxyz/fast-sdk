# Public Fast Sign Agent SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ultimatepowers:subagent-driven-development (recommended) or ultimatepowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the minimum public `@fastxyz/sign-sdk` agent package to `fastxyz/fast-sdk` without moving browser, website, backend, infrastructure, CLI, custody, or generic claim-building implementation.

**Architecture:** A Node-only package exposes one root entrypoint with high-level signing, exact recovery, journal-backed index registration, file hashing, and durable local journaling. Canonical Fast Sign and transaction codecs are public source because agents must locally verify what they sign, but they remain internal modules and can construct only one approved artifact-attestation `ExternalClaim`. Compatibility is fixed by synthetic vectors generated in the private repository and pinned to an exact private commit.

**Tech Stack:** TypeScript ESM, Node >=20.19.0, pnpm 10.1.0 workspace, Vitest, `@fastxyz/sdk@2.3.1`, `@fastxyz/schema@2.0.0`, Changesets, npm provenance.

---

## File map

**Documentation and evidence**

- Create: `docs/ultimatepowers/specs/2026-09-22-fast-sign-public-sdk.md`
- Create: `docs/ultimatepowers/plans/2026-09-22-fast-sign-public-sdk.md`
- Create: `packages/sign-sdk/provenance/source-files.json`
- Create: `packages/sign-sdk/provenance/release-evidence.schema.json`
- Create: `packages/sign-sdk/THIRD_PARTY_NOTICES.md`

**Package and distribution**

- Create: `packages/sign-sdk/package.json`
- Create: `packages/sign-sdk/LICENSE`
- Create: `packages/sign-sdk/README.md`
- Create: `packages/sign-sdk/tsconfig.json`
- Create: `packages/sign-sdk/tsconfig.build.json`
- Create: `packages/sign-sdk/vitest.config.ts`
- Create: `packages/sign-sdk/scripts/package-artifact.mjs`
- Create: `packages/sign-sdk/scripts/package-consumer.mjs`
- Create: `packages/sign-sdk/scripts/license-provenance.mjs`

**Public API**

- Create: `packages/sign-sdk/src/index.ts`
- Create: `packages/sign-sdk/src/types.ts`
- Create: `packages/sign-sdk/src/errors.ts`
- Create: `packages/sign-sdk/src/sign-client.ts`
- Create: `packages/sign-sdk/src/recovery.ts`
- Create: `packages/sign-sdk/src/record-client.ts`
- Create: `packages/sign-sdk/src/file-hash.ts`
- Create: `packages/sign-sdk/src/file-journal.ts`

**Internal protocol implementation**

- Create: `packages/sign-sdk/src/internal/address.ts`
- Create: `packages/sign-sdk/src/internal/attestation.ts`
- Create: `packages/sign-sdk/src/internal/bytes.ts`
- Create: `packages/sign-sdk/src/internal/canonical.ts`
- Create: `packages/sign-sdk/src/internal/fees.ts`
- Create: `packages/sign-sdk/src/internal/index-http.ts`
- Create: `packages/sign-sdk/src/internal/metadata.ts`
- Create: `packages/sign-sdk/src/internal/receipts.ts`
- Create: `packages/sign-sdk/src/internal/record-wire.ts`
- Create: `packages/sign-sdk/src/internal/transactions.ts`

**Tests and fixtures**

- Create: `packages/sign-sdk/test/fixtures/protocol.json`
- Create: `packages/sign-sdk/test/fixtures/provenance.json`
- Create: `packages/sign-sdk/test/helpers/harness.ts`
- Create: `packages/sign-sdk/test/helpers/certificates.ts`
- Create: `packages/sign-sdk/test/protocol.test.ts`
- Create: `packages/sign-sdk/test/transaction-boundary.test.ts`
- Create: `packages/sign-sdk/test/fees.test.ts`
- Create: `packages/sign-sdk/test/receipts.test.ts`
- Create: `packages/sign-sdk/test/index-http.test.ts`
- Create: `packages/sign-sdk/test/record-wire.test.ts`
- Create: `packages/sign-sdk/test/signing.test.ts`
- Create: `packages/sign-sdk/test/recovery.test.ts`
- Create: `packages/sign-sdk/test/record-client.test.ts`
- Create: `packages/sign-sdk/test/file-hash.test.ts`
- Create: `packages/sign-sdk/test/file-journal.test.ts`
- Create: `packages/sign-sdk/test/package-boundary.test.ts`
- Create: `packages/sign-sdk/test/package-consumer.test.ts`
- Create: `packages/sign-sdk/test/license-provenance.test.ts`

**Workspace**

- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Create: `.changeset/sign-sdk-public-agent-client.md`

### Task 1: Commit the approved specification, plan, and provenance skeleton

**Files:** documentation/evidence files listed above.

- [ ] **Step 1: Copy the approved normative spec and this plan into the worktree**

Use the reviewed bytes from `/private/tmp/sign-sdk-migration-specs/`; do not rewrite them during implementation.

- [ ] **Step 2: Add a failing provenance test**

Create `packages/sign-sdk/test/license-provenance.test.ts` that loads `provenance/source-files.json`, enumerates every `src/**/*.ts`, README/example/license/notice file intended for distribution, and requires exactly one record with `destination`, `classification`, `origin`, `copyright`, `license`, and `disposition: "approved"`.

- [ ] **Step 3: Run RED**

Run: `pnpm exec vitest run packages/sign-sdk/test/license-provenance.test.ts`
Expected: FAIL because the package/provenance inventory does not yet exist.

- [ ] **Step 4: Create the initial inventory schema and reviewed entries for the scaffold only**

Use JSON records of this shape:

```json
{
  "destination": "src/index.ts",
  "classification": "new",
  "origin": { "repository": "fastxyz/fast-sdk", "commit": null, "path": null, "blob": null },
  "copyright": "Copyright (c) Pi Squared, Inc.",
  "license": "Apache-2.0",
  "disposition": "approved"
}
```

Add one record whenever a later task adds a distributed file. For a derived #60 file, fill the exact pinned commit/path/blob from the spec.

- [ ] **Step 5: Commit documentation first**

```bash
git add docs/ultimatepowers packages/sign-sdk/provenance packages/sign-sdk/test/license-provenance.test.ts
git commit -m "docs(sign-sdk): define the public agent package boundary"
```

### Task 2: Scaffold a single-entrypoint, Node-only package

**Files:** package metadata, configs, `src/index.ts`, `src/types.ts`, package boundary tests.

- [ ] **Step 1: Write the failing package-boundary tests**

Require:

```ts
expect(manifest.name).toBe("@fastxyz/sign-sdk");
expect(manifest.version).toBe("0.0.0");
expect(manifest.license).toBe("Apache-2.0");
expect(manifest.engines.node).toBe(">=20.19.0");
expect(Object.keys(manifest.exports)).toEqual(["."]);
expect(manifest.dependencies["@fastxyz/sdk"]).toBe("2.3.1");
expect(manifest.dependencies["@fastxyz/schema"]).toBe("2.0.0");
expect(JSON.stringify(manifest)).not.toMatch(/workspace:|file:|github:/);
```

Also compile negative consumers importing `@fastxyz/sign-sdk/core`, `/browser`, `/node`, `/internal`, and `prepareExternalClaimTransaction`; each must fail.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run packages/sign-sdk/test/package-boundary.test.ts`
Expected: FAIL because the package does not exist.

- [ ] **Step 3: Add the minimal package scaffold**

The exports map is exactly:

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

Use exact production dependencies `@fastxyz/sdk@2.3.1`, `@fastxyz/schema@2.0.0`, `@noble/ed25519@2.3.0`, `@noble/hashes@1.8.0`, `bech32@2.0.0`, `effect@3.21.4`, and `json-with-bigint@3.5.8`. Do not declare `sideEffects: false` while Ed25519 setup has a module side effect.

- [ ] **Step 4: Run GREEN and typecheck**

Run: `pnpm --filter @fastxyz/sign-sdk test -- package-boundary.test.ts && pnpm --filter @fastxyz/sign-sdk typecheck`
Expected: package metadata assertions pass; negative consumers fail for the expected missing exports.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/package.json packages/sign-sdk/LICENSE packages/sign-sdk/README.md packages/sign-sdk/tsconfig*.json packages/sign-sdk/vitest.config.ts packages/sign-sdk/src/index.ts packages/sign-sdk/src/types.ts packages/sign-sdk/test/package-boundary.test.ts packages/sign-sdk/provenance/source-files.json pnpm-lock.yaml
git commit -m "feat(sign-sdk): scaffold the public agent package"
```

### Task 3: Implement the narrow canonical attestation codec

**Files:** internal bytes/canonical/metadata/attestation/address modules, fixtures, protocol test.

- [ ] **Step 1: Add synthetic accepted and rejected fixture tests**

Read committed fixtures only. Test exact bytes for each accepted relationship/metadata mode and explicit errors for unknown version, malformed UTF-16, invisible listed title, wrong digest/signer/request-id lengths, non-canonical numbers, duplicate fields, oversized input, and missing fixture.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- protocol.test.ts`
Expected: FAIL because the internal codec modules are missing.

- [ ] **Step 3: Port only the allowlisted pinned codec behavior**

Mechanically derive from the exact allowlisted blobs for `bytes.ts`, `canonical.ts`, `metadata.ts`, `address.ts`, and `attestation-v3.ts`; move them under `src/internal/`, preserve SPDX/copyright, update only import paths, and record every origin in `source-files.json`. Do not port `core/index.ts` or export these modules.

- [ ] **Step 4: Run GREEN and mutation witness**

Run the protocol test, then temporarily remove one canonical field-order check and confirm only the corresponding reject witness becomes red; revert the mutation and rerun green.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/src/internal packages/sign-sdk/test/fixtures packages/sign-sdk/test/protocol.test.ts packages/sign-sdk/provenance/source-files.json
git commit -m "feat(sign-sdk): encode canonical artifact attestations"
```

### Task 4: Construct exactly one approved ExternalClaim

**Files:** `src/internal/transactions.ts`, `src/errors.ts`, transaction tests.

- [ ] **Step 1: Write boundary-first failing tests**

Decode the prepared transaction and assert:

```ts
expect(operations).toHaveLength(1);
expect(operations[0]?.type).toBe("ExternalClaim");
expect(operations[0]?.value.claim.claimData).toBe(`0x${expectedClaimDataHex}`);
expect(operations[0]?.value.claim.verifierCommittee).toEqual([]);
expect(operations[0]?.value.claim.verifierQuorum).toBe(0);
```

Negative consumers must be unable to pass `claimDataHex`, arbitrary operations, or a second claim. A mutation that appends a second operation before signing must be rejected by canonical rederivation.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- transaction-boundary.test.ts`
Expected: FAIL because transaction preparation is absent.

- [ ] **Step 3: Implement the internal transaction builder**

Derive only the approved behavior from the pinned `transactions.ts` blob. Keep `prepareExternalClaimTransaction`, raw prepared types, byte helpers, and claim-data arguments internal. The only future caller is the high-level Sign client.

- [ ] **Step 4: Run GREEN and second-claim mutation**

Confirm the focused suite rejects the mutated two-operation value before signer/provider submission, then revert.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/src/internal/transactions.ts packages/sign-sdk/src/errors.ts packages/sign-sdk/test/transaction-boundary.test.ts packages/sign-sdk/provenance/source-files.json
git commit -m "feat(sign-sdk): prepare one canonical external claim"
```

### Task 5: Add bounded fees, receipt validation, record wire, and index HTTP

**Files:** internal fee/receipt/record/index modules and focused tests.

- [ ] **Step 1: Write failing tests for public-wire safety**

Cover redirects rejected, 15-second default deadline, bounded response bodies, exact network/tx/hash lookup, exact 200 record success, 409 conflict, retryable 408/429/5xx, terminal 4xx, fee-unavailable fail closed, fee schedule drift, malformed/oversized certificate, signer/nonce/tx/claim mismatch, and exact record serialization.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- fees.test.ts receipts.test.ts index-http.test.ts record-wire.test.ts`.

- [ ] **Step 3: Implement from pinned allowlisted blobs**

Move only required functions under `src/internal/`; export no raw helpers. Preserve byte/depth/node bounds and captured AbortSignal cleanup.

- [ ] **Step 4: Run GREEN**

Expected: focused suites pass with no real network.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/src/internal packages/sign-sdk/test packages/sign-sdk/provenance/source-files.json
git commit -m "feat(sign-sdk): validate fees receipts and index records"
```

### Task 6: Implement the durable Node journal and file hashing

**Files:** `src/file-journal.ts`, `src/file-hash.ts`, their tests.

- [ ] **Step 1: Write failing Node tests**

Cover streaming SHA-256, before/after identity checks, 1 MiB bounded journal read, ordinary-object limits, `0700` directories, `0600` files, traversal/symlink rejection, same-filesystem temp+fsync+rename, stale live/dead lock behavior, operation-ID filename hashing, and atomic rollback on write failure.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- file-hash.test.ts file-journal.test.ts`.

- [ ] **Step 3: Port the two pinned Node modules**

Preserve headers and bounds, update imports, expose only the approved root symbols, and inventory their exact origins.

- [ ] **Step 4: Run GREEN**

Expected: focused Node tests pass and leave no scratch files.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/src/file-*.ts packages/sign-sdk/test/file-*.test.ts packages/sign-sdk/provenance/source-files.json
git commit -m "feat(sign-sdk): add durable agent recovery storage"
```

### Task 7: Implement exact recovery and journal-only registration

**Files:** `src/recovery.ts`, `src/record-client.ts`, recovery/record tests.

- [ ] **Step 1: Write failing state-machine tests**

Cover operation binding, `prepared`, `submission_unknown`, settled, pending, conflict, rejected, registered; exact GET-only recovery; no new nonce/signer/submit during recovery; receipt persisted before record POST; retry without signer; no downgrade from terminal states; mismatch becomes conflict; missing exact row remains pending; journal save failure reports `recoveryPersisted: false`.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- recovery.test.ts record-client.test.ts`.

- [ ] **Step 3: Implement recovery from the pinned blob and a narrower record client**

The public `RecordClientOptions` contains `network`, `indexOrigin`, `journal`, optional `fetchImpl`, `deadlineMs`, and `now`; it has no `storage` union. `retryRegistration` performs one explicit bounded POST, reconciles 409 by exact GET, and persists the resulting journal state. `checkRegistration` performs exact GET only. There is no physical outbox, browser migration, automatic loop, or hidden resubmission.

- [ ] **Step 4: Run GREEN and no-signer mutation**

Make signer/provider spies throw if touched during retry/recovery. Temporarily route recovery through submit and confirm the witness turns red; revert.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/src/recovery.ts packages/sign-sdk/src/record-client.ts packages/sign-sdk/test/recovery.test.ts packages/sign-sdk/test/record-client.test.ts packages/sign-sdk/provenance/source-files.json
git commit -m "feat(sign-sdk): recover and register without resubmission"
```

### Task 8: Implement the high-level signing client and exact root exports

**Files:** `src/sign-client.ts`, `src/index.ts`, signing tests.

- [ ] **Step 1: Write failing end-to-end capability tests**

Use fake signer/provider/journal/index. Assert immutable input ownership before first await, fee authorization, prepared state before signing, submission evidence before submit, exact one-submit behavior, local signature verification, indeterminate result on lost/malformed response, validated receipt persistence, and one registration attempt after settlement.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- signing.test.ts`.

- [ ] **Step 3: Implement the minimum client**

Derive behavior from the pinned sign-client blob, but call only the new internal codec/transaction modules and journal-only record client. Export from `src/index.ts` only the exact symbols listed in spec section 6.

- [ ] **Step 4: Run GREEN and critical mutations**

Confirm focused tests fail when input snapshotting, pre-submit persistence, signature verification, or indeterminate blocking is removed; revert each mutation separately.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk/src/sign-client.ts packages/sign-sdk/src/index.ts packages/sign-sdk/test/signing.test.ts packages/sign-sdk/provenance/source-files.json
git commit -m "feat(sign-sdk): expose the agent signing workflow"
```

### Task 9: Audit the package, licenses, and isolated consumer

**Files:** package scripts/tests, README/notices, release-evidence schema.

- [ ] **Step 1: Write failing tarball and license tests**

Require exact inventory, no sources/maps/tests/fixtures/private paths/absolute paths/CLI/browser/outbox/infra, exact root exports, no install scripts, no secret patterns, exact dependencies, Apache license/NOTICE, and complete file/dependency inventory.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @fastxyz/sign-sdk test -- package-consumer.test.ts license-provenance.test.ts`.

- [ ] **Step 3: Implement audit scripts and documentation**

The isolated consumer installs the local tarball with scripts disabled, checks lockfile resolution, imports only the root API, constructs a no-network client with fake capabilities, and proves forbidden deep imports fail. Generate the dependency license inventory from the exact lockfile; unresolved license evidence is a blocking failure, not an assumed approval.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @fastxyz/sign-sdk build && pnpm --filter @fastxyz/sign-sdk smoke:package && pnpm --filter @fastxyz/sign-sdk audit:license`.

- [ ] **Step 5: Commit**

```bash
git add packages/sign-sdk packages/sign-sdk/provenance/source-files.json
git commit -m "test(sign-sdk): audit the public distribution boundary"
```

### Task 10: Integrate workspace CI and release metadata

**Files:** root README, CI, lockfile, changeset.

- [ ] **Step 1: Add the minor changeset**

```markdown
---
"@fastxyz/sign-sdk": minor
---

Add the public Node agent SDK for canonical Fast Sign artifact attestations, exact recovery, and signer-free index registration.
```

- [ ] **Step 2: Add exact CI gates**

For Node 20 and 22, CI runs package typecheck, tests, build, tarball consumer, export/tarball audit, and license provenance. It performs no npm publish, deploy, Docker build, or live request.

- [ ] **Step 3: Run workspace gates**

Run:

```bash
pnpm --filter @fastxyz/sign-sdk typecheck
pnpm --filter @fastxyz/sign-sdk test
pnpm --filter @fastxyz/sign-sdk build
pnpm --filter @fastxyz/sign-sdk smoke:package
pnpm test
pnpm build
git diff --check origin/develop...HEAD
```

Expected: all commands exit 0; no live-network test runs.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .changeset README.md pnpm-lock.yaml
git commit -m "ci(sign-sdk): gate the public package artifact"
```

### Task 11: Independent review and draft PR

- [ ] **Step 1: Review the exact diff against the spec**

Check every production file against the source allowlist/provenance inventory and verify excluded #60 classes are absent.

- [ ] **Step 2: Verify clean worktree and commit separation**

Run: `git status --short`, `git log --oneline origin/develop..HEAD`, and `git diff --stat origin/develop...HEAD`.

- [ ] **Step 3: Push normally and open a draft PR to `develop`**

The body states the exact private context commit, public boundary, license/provenance status, focused RED→GREEN evidence, exact-head CI status, no-publication guarantee, and dependency relationship to the private PR.

- [ ] **Step 4: Freeze the exact head**

Report the full remote SHA. Do not mark ready, merge, publish, deploy, or create a release.
