# Release 1 — local consumer evidence

Observed on 2026-10-08 using isolated copies of the latest consumer `main`
available when each copy was created. No consumer source, manifest, lockfile,
deployment, order, or real payment was changed. Candidate artifacts were built
from the Release 1 adapter work in this PR.

| Consumer / immutable baseline                                    | Baseline and candidate results                                    | Remaining coverage                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `fast-mcp` — `81fc3db71abaa972b65bdd4fda20cd292c4a49f2`          | 257 tests; build and lint passed                                  | Re-run against versioned 1.1 release candidates before publication                                                              |
| `fast-shop` — `3eadbd0e7f80a936ceb54c9ad35612ac022969f5`         | 2,265 tests in 100 files; typecheck and lint passed               | Three HTTP app suites excluded; opening local listeners was blocked, and expanded execution was denied by the approval reviewer |
| `fast-shop-zinc` — `db28326f39f0ae9db0afe84c7b5e2219976ac5fb`    | 345 unit tests; build and lint passed with existing lint warnings | Paid/service E2E and database integration were not run                                                                          |
| `fast-shop-shopify` — `248095fc2de22a19689c0bf8d356bcaf3f2029ab` | 179 tests; build and lint passed with existing lint warnings      | 11 database tests skipped without a local database; checkout/payment E2E was not run                                            |

## Method and limits

The SDK's changeset targets 1.1.0, but the packed development artifacts still
carry their pre-versioning 1.0.x manifest versions. These runs establish local
candidate-code compatibility only: **they do not complete the plan's publishing
gate for versioned 1.1.0 packages or all consumer tests**.

The MCP and merchant checks used locally packed dependencies without saving
consumer manifests or lockfiles. Shopify's existing Bun-resolved Zod peer
combination is rejected by npm's strict peer resolver; the local candidate check
used npm's legacy peer policy, and therefore does not certify its native Bun
installation path.

An initial Fast Shop candidate install also re-resolved unrelated AI dependencies
and caused 11 tool-choice test failures. Restoring the consumer's exact locked
dependency graph and replacing only the compiled x402 artifacts restored all
2,265 selected tests. The table reports that isolated comparison, not the
confounded dependency-refresh run.

The Fast Shop full baseline attempt failed when its HTTP suites tried to open
local listeners in the sandbox. The approval reviewer denied broader execution
because of potential commerce effects. No workaround, real checkout, payment,
admin mutation, or production connection was used. That coverage needs a safely
approved local run before claiming the complete gate.

The actual eight-payment historical 1.0 / candidate 1.1 testnet matrix remains a
separate, explicitly authorized live gate. Skips are not passes.
