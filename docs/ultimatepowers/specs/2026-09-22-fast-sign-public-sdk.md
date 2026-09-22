# `@fastxyz/sign-sdk` in `fast-sdk` — public agent SDK specification

**Status:** Draft for owner approval  
**Destination repository:** `fastxyz/fast-sdk`  
**Target branch:** `develop`  
**Package:** `packages/sign-sdk` / `@fastxyz/sign-sdk`  
**License:** Apache-2.0  
**Normative authority:** this specification  
**Non-normative implementation context:** `fastxyz/fast-sign#60` at exact commit `5448840abe71ce5eef3d1540c4c7477092cc2379`, without merging that PR

## 1. Motivation

Fast Sign needs a supported programmatic surface for agents to attest an artifact, submit the corresponding Fast `ExternalClaim`, recover safely from an indeterminate submission, and register an observed settlement in the Sign index.

That surface must be installable from the public `fast-sdk` workspace, following the repository ownership model already used by `@fastxyz/fastid-sdk` and `@fastxyz/allset-sdk`. The private `fast-sign` repository must remain the home of the website, indexer, backend, database, infrastructure, and operational implementation.

PR #60 combined two materially different changes:

1. a candidate public SDK; and
2. a private website refactor that imported the SDK, moved browser outbox logic, and changed build/deployment files.

Merging that PR would place the package in the wrong repository and would make substantially more implementation public than agents require. It will therefore not be merged. This PR replaces only its public-SDK objective.

### 1.1 Normative source and pinned context

This specification is the source of truth. PR #60 is only historical and implementation context. A later commit, force-push, body edit, review comment, or resolution in #60 cannot alter this specification or the implementation scope.

Only the following files at commit `5448840abe71ce5eef3d1540c4c7477092cc2379` may be consulted as production-code references, and even those files must be reduced to the behavior required by this specification rather than copied wholesale:

| Reference path | Blob SHA | Permitted reference purpose |
|---|---|---|
| `fastset-sign-sdk/src/client/errors.ts` | `25b3a8d88bd892f6ba7010deb00ece2729188945` | public typed failures |
| `fastset-sign-sdk/src/client/sign-client.ts` | `dd3462f1431902f2f2ea8a48f0e4032649395bc3` | high-level signing order and recovery states |
| `fastset-sign-sdk/src/client/recovery.ts` | `8796c4280223ebb469f62150597a35c174dbc20a` | exact read-only settlement recovery |
| `fastset-sign-sdk/src/client/record-client.ts` | `efbae2892148ca2d45926cd35dff69654d9e757e` | journal-backed registration only; browser/storage mode excluded |
| `fastset-sign-sdk/src/core/address.ts` | `b75893520b79f22314dd3fdd472579b8ca44a093` | Fast sender derivation |
| `fastset-sign-sdk/src/core/attestation-v3.ts` | `db69b9e1cf672e87541a156e8a69dbf4585ac6b1` | approved artifact-attestation codec |
| `fastset-sign-sdk/src/core/attestation.ts` | `5a50c683b763b9e110d12e4589981d16e2f3c8a6` | bounded public claim reading needed by the approved flow |
| `fastset-sign-sdk/src/core/bytes.ts` | `8e29053813a362eb63dad8bacf1a42b2735ab763` | strict byte/hex conversion |
| `fastset-sign-sdk/src/core/canonical.ts` | `45171bb7aa78e260ef90974558b6bc6845c12f9a` | internal canonical encoding only |
| `fastset-sign-sdk/src/core/fees.ts` | `c77c1fa44a56f66ebb8a0048892ef54417764647` | bounded fee discovery and policy |
| `fastset-sign-sdk/src/core/metadata.ts` | `a565c89700506f4d5f77ce5bf9ff718f3b28768a` | Fast Sign metadata validation |
| `fastset-sign-sdk/src/core/receipts.ts` | `13076942bf3a8216ff4d7338bb8dd6ed5f779c21` | bounded settlement evidence validation |
| `fastset-sign-sdk/src/core/record-wire.ts` | `06e737c8cbf4f90b6f889a639034fbc7c0e1c232` | exact public index wire |
| `fastset-sign-sdk/src/core/transactions.ts` | `7dcee57039f92b48784b09bc1f643c01a7cae630` | construction of the single approved `ExternalClaim` |
| `fastset-sign-sdk/src/core/types.ts` | `6faa48c59fe8411cffa2e4bec76aa946af4c2058` | minimum public capability types |
| `fastset-sign-sdk/src/indexing/http.ts` | `9a5929b4a07cdda16c92b99c12daa6c0c03fb500` | bounded public index HTTP client |
| `fastset-sign-sdk/src/node/file-hash.ts` | `1afcd1567ace035aaded48378c8ae56555e6d715` | streaming local file hash |
| `fastset-sign-sdk/src/node/file-journal.ts` | `e3e153bce92ca92bf4ea33bef6f42516ccad0dba` | durable local agent journal |

The reviewed tests and synthetic fixtures under `fastset-sign-sdk/test/` at that same commit may be consulted as witnesses. They are not normative and may not broaden the API.

All other #60 files are outside the public source-reference allowlist. In particular, `src/browser/**`, `src/indexing/outbox-delivery.ts`, `src/indexing/outbox-state.ts`, web code, CI, Docker/Railway, package metadata, preview licensing files, and deployment documentation must not be copied. When a permitted reference imports an excluded file, the implementation must provide the narrower behavior described here or omit the dependent capability; the exclusion may not be bypassed by renaming or inlining the file.

## 2. Confidentiality model

Everything committed to `fastxyz/fast-sdk` is public, including files that are not present in the npm tarball and functions that are not exported. TypeScript module boundaries, bundling, minification, private class members, and undocumented subpaths do not provide confidentiality.

The public repository may contain only logic that must execute on an agent-controlled machine to use Fast Sign safely:

- canonical encoding of the Fast Sign artifact attestation;
- construction of the corresponding Fast `ExternalClaim` transaction;
- derivation of the exact signing bytes and transaction identifier;
- local verification of the signer response;
- bounded fee discovery and validation;
- submission through caller-supplied Fast capabilities;
- validation and persistence of settlement evidence;
- read-only recovery after an indeterminate submission;
- index registration and signer-free retry;
- local file hashing and a durable agent-side journal.

The following remain private and must not be copied, generated, bundled, or described in sufficient detail to reconstruct private operations:

- website components, routes, React/Next code, browser state, and browser outbox implementation;
- Sign indexer implementation, private reconciliation policies, database schema, migrations, and database roles;
- backend routes and internal service topology beyond the public HTTP contracts consumed by the SDK;
- infrastructure, Docker, Railway, deployment configuration, environment inventories, operational runbooks, and monitoring;
- credentials, secrets, signing keys, private recovery records, real receipts, production fixtures, and account data;
- administrative or operator-only capabilities;
- private rate-control, anti-abuse, incident-response, or deployment logic;
- CLI, keystore, custody, wallet UI, and credential prompts.

No file may enter this package merely because it existed in #60. Every production file must be reachable from an approved agent capability below or be required to build/test/distribute that capability.

## 3. Goals

The PR must:

1. add a public, installable `@fastxyz/sign-sdk` package to the `fast-sdk` workspace;
2. let a Node agent sign an artifact digest or file without disclosing the private key to Fast Sign;
3. construct the canonical Fast Sign attestation and its single Fast `ExternalClaim` locally;
4. fail closed before signing or submission when metadata, fees, destinations, signer identity, or canonical inputs are invalid;
5. preserve enough durable state before effects to recover safely from a lost submission response;
6. validate returned or subsequently observed settlement evidence against the exact frozen operation;
7. allow index registration to be checked or retried without the signer;
8. expose only a small domain API, not the implementation toolkit used to build it;
9. produce an audited npm tarball with public provenance and no private-repository material;
10. ship with tests that fix the byte-level compatibility contract.

## 4. Non-goals

This PR does not:

- merge, cherry-pick wholesale, or depend at runtime on `fast-sign#60`;
- refactor the Fast Sign website to consume the public SDK;
- add browser support or a browser persistence adapter;
- add a generic Fast `ExternalClaim` construction toolkit;
- support arbitrary claim schemas;
- publish a CLI or manage private keys;
- expose raw canonical-JSON parsers or transaction-schema internals as stable API;
- change Fast Sign contracts, index API, backend, database, validator, proxy, or deployment;
- publish the npm package as part of the PR;
- enable automatic signing, automatic retry of an indeterminate submission, or implicit fee authorization;
- claim quorum/trustless verification when evidence was observed through the configured proxy.

## 5. Package identity and release model

The package must use:

- name: `@fastxyz/sign-sdk`;
- workspace directory: `packages/sign-sdk`;
- source version: `0.0.0`;
- license: `Apache-2.0`;
- `publishConfig.access: public`;
- npm provenance enabled;
- ESM only;
- Node.js `>=20.19.0`;
- no `bin`, install hooks, postinstall hooks, native addon, downloaded binary, or runtime fetch of source code.

A minor changeset introduces the package as `0.1.0` through the normal `fast-sdk` Version PR and release process. Opening or merging this implementation PR does not itself authorize npm publication.

The Node engine requirement is exactly `>=20.19.0`; it is not conditional on later implementation preference. Changing it requires a spec amendment.

Protocol-bearing Fast dependencies are exact published versions:

- `@fastxyz/sdk`: `2.3.1`;
- `@fastxyz/schema`: `2.0.0`.

The source manifest must use those exact versions, not `workspace:*`, a semver range, tag, Git branch, local path, or unpublished tarball. The workspace lockfile must resolve those exact releases and retain their registry URLs and SHA-512 integrity values. Upgrading either dependency requires explicit compatibility fixtures and review; a workspace implementation newer than the pinned published release must not determine protocol bytes accidentally.

## 6. Public API boundary

The package has one supported entrypoint:

```text
@fastxyz/sign-sdk
```

There are no `./core`, `./browser`, `./node`, `./internal`, or wildcard exports. Deep imports are unsupported and blocked by the exports map.

The root entrypoint may export only the following capability groups.

### 6.1 Signing

- `createSignClient`
- `SignClient`
- `SignClientOptions`
- `SignResult`
- `SignInput`
- `SignNetwork`
- `Relationship`
- `ByteSigner`
- `FastSettlementProvider`
- `createFastSdkProviderAdapter`
- the typed errors needed for fee, nonce, signer, signature, and indeterminate-submission handling

The high-level client accepts an artifact SHA-256 digest plus the approved Fast Sign metadata. It owns the operation inputs before the first asynchronous boundary, derives the attestation, constructs exactly one `ExternalClaim`, prepares the Fast transaction, obtains an explicit signer response, verifies it locally, and submits through the supplied provider.

The caller supplies the signer and provider. The SDK never reads, requests, serializes, persists, logs, or transmits a private key.

### 6.2 Recovery and evidence

- `recoverSettlement`
- `verifyReceipt`
- `registerReceipt`
- `RecoveryJournal`
- `JournalSnapshot` and its discriminated states
- `SettlementReader`
- `PendingRegistration`
- `VerifyReceiptResult`
- `SettlementRecoveryResult`

Recovery is read-only until an explicitly requested registration retry. A lost submit response remains indeterminate unless the exact expected transaction is observed. The SDK must not allocate a new nonce, generate a replacement settlement, or infer success from absence.

### 6.3 Index registration

- `createRecordClient`
- `RecordClient`
- `RecordClientOptions`
- `RegistrationState`
- `RegistrationResult`

The public agent client is journal-backed only. The browser `StorageLike` mode, physical outbox migration, browser reconciliation, storage-event observer, and browser-delivery API from #60 are excluded.

The record client may check or retry registration of an already-settled receipt. Retry must not require a signer, nonce read, or settlement submission capability.

### 6.4 Node utilities

- `createFileJournal`
- `FileJournalOptions`
- `hashFile`
- `HashFileOptions`
- `FileChangedDuringHashError`

These utilities are exported from the root because the package is deliberately agent/Node focused. A future browser entrypoint requires a separate issue and review.

### 6.5 What is deliberately not exported

The following remain internal implementation details even when their code is necessarily public:

- canonical JSON field machinery;
- raw attestation encoder/decoder primitives;
- byte/hex helpers;
- metadata validators;
- raw fee-token helpers;
- raw transaction preparation/signing functions;
- record-wire serializer;
- index HTTP client;
- receipt certificate traversal helpers;
- journal file-layout helpers;
- internal constants not needed to call or safely interpret the domain API.

The SDK must not expose a generic `prepareExternalClaimTransaction(claimDataHex)` API. It supports only the Fast Sign artifact-attestation claim that it can validate completely.

An exact export witness must enumerate every root export and fail on any additional symbol or subpath. A negative TypeScript/Node consumer must prove that generic claim input, raw `claimDataHex`, arbitrary operation arrays, and deep imports are unavailable through the published package.

## 7. Canonical codec requirements

The codec is required public source because agents must know and verify the exact bytes they authorize. It is not a generic public toolkit.

The internal codec must:

1. accept only the approved Fast Sign artifact-attestation schema and version;
2. validate all metadata and relationship values before signer/provider effects;
3. encode the attestation deterministically and within the existing size limit;
4. build exactly one Fast `ExternalClaim` with no verifier committee, quorum, or signatures beyond the transaction sender signature required by the existing flow;
5. preserve the exact network, sender, nonce, timestamp, fee token, and claim data used to derive the signing bytes;
6. derive the transaction ID from the same owned transaction snapshot;
7. rederive and compare evidence immediately before accepting a signer response;
8. verify the Ed25519 signature locally with the strict approved mode;
9. reject non-canonical, oversized, unknown-version, or structurally invalid data;
10. never accept an arbitrary opaque claim payload supplied by an agent.

The decoded prepared transaction must contain exactly one operation and that operation must be the approved Fast Sign `ExternalClaim`. A focused witness must fail if the implementation appends or accepts a second `ExternalClaim`, any second operation, or a caller-provided claim payload. Re-derivation immediately before signing must reject a prepared value mutated to contain a second claim.

Compatibility is fixed by public, synthetic fixtures containing inputs, encoded attestation bytes, signing bytes or stable digests, transaction identifiers, and expected failures. Fixtures contain no production data.

## 8. Signing and fee safety contract

The operation order is:

1. validate and snapshot configuration and input;
2. load or create the durable operation under an operation lock;
3. bind the operation ID permanently to immutable input and destinations;
4. obtain and validate the signer public key;
5. read and freeze the nonce;
6. resolve and authorize the fee under an explicit caller policy;
7. persist the prepared operation before asking for a signature;
8. derive the exact signing bytes;
9. request and locally verify one signer response;
10. persist signed submission evidence before network submission;
11. submit once;
12. classify the result as settled or indeterminate;
13. persist a validated receipt before attempting index registration;
14. register or retain the receipt for signer-free retry.

No import or object construction authorizes a signature or fee. Fee authorization is explicit caller policy. An indeterminate submit result never triggers an automatic second transaction.

## 9. Durable recovery contract

The journal must preserve the immutable operation, frozen destinations, signer identity, nonce, timestamp, fee decision, claim bytes, signing bytes, transaction bytes, transaction ID, sender signature, receipt, and registration state necessary for safe recovery.

Required properties:

- an operation ID cannot be rebound to different inputs, signer, network, proxy, or index origin;
- operation and account locks prevent local concurrent nonce reuse;
- signed evidence is durable before submit;
- a lost response transitions to `submission_unknown` and remains blocked from resubmission;
- recovery queries only the configured read capability for the exact sender/nonce/transaction;
- a recovered certificate must validate against the exact frozen claim and signature;
- registration failure does not authorize another settlement;
- journal write failure is returned honestly and never represented as durable recovery;
- the file journal stores no private key or signer implementation.

## 10. Public/private compatibility seam

The public SDK and private Fast Sign implementation share a byte-level protocol, not source code.

The public repository contains synthetic compatibility vectors and records their provenance with:

- schema/vector version;
- generator identity;
- full source commit SHA from `fast-sign`;
- generation command description;
- content hash.

The private repository owns the authoritative fixture generator because it may depend on private website implementation. The public test suite only reads committed fixtures and must fail if they are missing. Regeneration must be an explicit, reviewed operation; tests must not silently rewrite expected output.

## 11. Workspace integration

The PR updates only the files required by normal `fast-sdk` package ownership:

- `packages/sign-sdk/**`;
- workspace lockfile;
- root package/workspace metadata if required;
- package-oriented CI matrix or workflow;
- root README/package catalogue;
- release documentation where the repository requires it;
- one minor changeset.

The package must use the exact published `@fastxyz/sdk@2.3.1` and `@fastxyz/schema@2.0.0` dependencies specified above and must not reference private repository paths, GitHub tokens, local absolute paths, mutable ranges, or unpublished tarballs.

Commits should be split by coherent capability: scaffold/distribution, codec/transaction, signing client, recovery/index registration, journal/hash, and package/CI documentation.

## 12. License and source-provenance gate

Selecting Apache-2.0 for the new package does not relicense code automatically. Before any implementation file is committed to the public package, and again for the exact release commit, the PR must contain or link a machine-readable and human-reviewable provenance inventory covering every distributed source file.

For each first-party source/document/example, the inventory records:

- destination path;
- classification: newly authored, copied, or derived;
- originating repository, exact commit, path, and blob SHA when copied or derived;
- original copyright holder and header;
- original SPDX/license basis;
- destination SPDX/header;
- reviewer disposition confirming that redistribution under Apache-2.0 is authorized.

Files copied or derived from the pinned #60 context must preserve applicable copyright notices and Apache-2.0 SPDX headers. The preview `LICENSE` from #60 is explicitly excluded and provides no package-wide grant. A missing, conflicting, unknown, or owner-gated origin blocks publication rather than being inferred away.

For dependencies, generate an inventory/SBOM for the exact production dependency graph resolved by the release lockfile. It records package name, exact version, integrity, registry/source URL, declared license, license-file evidence, and disposition. Unknown, missing, custom, copyleft, or incompatible terms require explicit legal/owner disposition before publication. The current npm metadata for `@fastxyz/sdk@2.3.1` and `@fastxyz/schema@2.0.0` does not itself expose a `license` field, so their license basis must be established from authoritative repository/package artifacts rather than assumed.

The released package contains the Apache-2.0 license text, required copyright/NOTICE material, and third-party notices derived from the approved inventory. Automated header and dependency-license checks must fail on an unclassified distributed file or dependency.

## 13. Distribution and disclosure gates

Before the PR is merge-ready, automated checks must prove:

- only the root entrypoint resolves;
- the exported symbol allowlist is exact;
- a plain Node consumer can install the packed tarball, typecheck, and execute a no-network smoke test;
- the tarball contains only compiled JavaScript, declarations, license/notices, README, and explicitly approved docs/examples;
- no TypeScript source, source map, test, fixture, local path, private-repository filename, infrastructure file, secret-like material, recovery record, or CLI/keystore path is packed;
- examples are inert on import and receive signer/network/storage dependencies from the caller;
- browser-specific modules and React/Next dependencies are absent;
- dependencies contain no private package or private Git source;
- the license and third-party notices are present;
- npm provenance and public access are configured but publication is not performed.

The pack audit is a risk-reduction check, not a confidentiality proof. Human review of the exact tarball remains required before release.

### 13.1 Published-artifact verification

Publication is not complete merely because the expected version appears in the registry. For the exact released version, an immutable release-evidence record must capture and verify:

- package name and exact version;
- exact `fast-sdk` release commit SHA;
- GitHub Actions workflow/run identity and trusted publishing environment;
- registry-resolved `dist.tarball` URL;
- registry `dist.integrity` SHA-512 value;
- downloaded tarball SHA-512 recomputed locally and matched to `dist.integrity`;
- registry attestation URL and predicate type;
- verified provenance subject digest and source repository/commit identity;
- package file-content manifest compared with the locally audited candidate built from the release commit;
- isolated consumer lockfile entry containing the exact version, resolved tarball URL, and identical integrity;
- successful registry-signature/provenance verification using the supported npm verification command;
- extracted package metadata matching name, version, license, repository, exports, and Node engine requirements.

The public release gate fails if the tarball URL is mutable/unexpected, integrity differs, provenance does not bind the artifact to `fastxyz/fast-sdk` and the exact release commit, the lockfile resolves a different artifact, or extracted contents differ from the audited candidate manifest.

The release-evidence record contains no credentials and may be committed or attached immutably to the release/PR. Its exact values are later pinned by the private residual PR.

## 14. Required tests

At minimum:

1. accepted/rejected canonical attestation fixtures;
2. exact transaction/signing evidence from owned inputs;
3. mutation after an async boundary cannot change frozen inputs;
4. signer/public-key mismatch and invalid signature fail before submission;
5. fee unavailable/changed/outside policy fails closed;
6. journal persistence occurs before signer and submit effects where required;
7. exact-once local submit attempt under retries/concurrency;
8. indeterminate response is recoverable only through exact read-only evidence;
9. recovery cannot substitute a transaction, nonce, signer, network, claim, or destination;
10. settled receipt persists before index registration;
11. index failure retains a signer-free retry artifact;
12. registration conflict/rejection/pending/registered states remain distinguishable;
13. file hashing detects observable changes during reading;
14. journal path, permissions, bounded read, atomic write, and locking behavior;
15. public export allowlist;
16. forbidden deep imports;
17. tarball allowlist and isolated consumer smoke;
18. no network, signature, or submission occurs merely by importing the package.
19. the decoded transaction contains exactly one approved `ExternalClaim` and mutation to add a second is rejected;
20. generic claim constructors, raw claim payload inputs, and non-root/deep exports are absent;
21. every distributed file and production dependency is classified by the license/provenance inventory;
22. the published tarball, integrity, provenance, lockfile resolution, and release commit agree.

Critical mutation witnesses must demonstrate that removing input snapshotting, canonical re-encoding, signer verification, durable pre-submit persistence, or indeterminate-submission blocking makes a focused test fail.

## 15. CI and evidence

GitHub Actions must run on the exact PR head using supported Node versions and execute package build, typecheck, tests, packed-consumer smoke, export audit, tarball audit, and repository diff checks.

Tests already run by GitHub Actions need not be duplicated manually solely for review. Focused RED→GREEN evidence may be run during implementation. The PR body must distinguish local focused evidence from exact-head CI.

No workflow may publish npm artifacts, Docker images, caches containing source outside existing policy, releases, deployments, or transactions.

## 16. Sequencing and merge gates

1. Open this PR as draft against `fast-sdk/develop`.
2. Obtain adversarial review of code, public exports, tarball, body, and comments.
3. Merge only after exact-head CI is green and the owner approves the public boundary.
4. Let the normal Version PR produce the release version.
5. Publish only through the separately authorized repository release process.
6. Verify the exact registry artifact and persist the release-evidence record described above.
7. Only after that verification may the paired private `fast-sign` PR advertise an installable version and become merge-ready.
8. PR #60 remains unmerged throughout this sequence.

## 17. Acceptance criteria

The PR is acceptable when:

- `@fastxyz/sign-sdk` is a public Apache-2.0 package in `fast-sdk` with a single root entrypoint;
- an agent can sign, recover, verify, register, and retry the approved Fast Sign artifact-attestation flow;
- codecs necessary to construct the claim are present but no generic raw claim toolkit is public;
- browser/outbox, website, backend, database, infrastructure, CLI, and custody code are absent;
- the public API and tarball match explicit allowlists;
- fixtures establish byte-level compatibility with a pinned private source commit;
- no generic claim API exists and exactly one approved `ExternalClaim` is constructed;
- exact published protocol dependencies and the Node floor are fixed as specified;
- source/dependency license provenance is complete and approved for Apache-2.0 distribution;
- the published tarball's SHA-512, provenance, source commit, contents, and consumer lockfile resolution are independently verified;
- all required exact-head CI checks pass;
- the PR performs no publication, deployment, live transaction, or default flip;
- the PR body states the residual risks and dependency on the paired private PR/release sequence honestly.
