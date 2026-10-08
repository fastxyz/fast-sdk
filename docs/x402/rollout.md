# x402 v2 rollout ledger

Status: Phase 0 in progress. No gate is passed by this document, and no package has been released or production service migrated.

## Work sequence

PR preparation order (updated by the operator): prepare the SDK and other
non-merchant changes first; Fast Shop merchant adapter PRs (Zinc and Shopify,
including their rollout overlays) come last. PR creation order does not authorize
buyer activation: buyer changes remain gated or unmerged until every seller they
call supports both versions and the relevant live gates pass. No merchant code
or deployment is changed before those final merchant PRs.

1. Phase 0: validate pinned upstream contracts, expand inventory, and settle the [Fast exact scheme](scheme_exact_fast.md), especially durable replay ownership and default-asset policy.
2. Phase 1: build the Fast mechanism and compatibility wrappers using failing-first tests; port EVM support to the Foundation mechanism; adapt CLI dry-run and payment handling; run Gate 1's version and interop matrix.
3. Phase 2: deploy dual-version sellers, with the flowers canary first; instrument header-version and paid-but-unfulfilled outcomes; pass Gate 2.
4. Phase 3: finish redaction before any buyer sends v2, migrate buyers only after all their seller dependencies pass, update docs to the actually released contract.
5. Phase 4: after Gate 1, synchronize the fork, submit upstream work, migrate the benchmark, and archive the obsolete demo only after ownership/liveness confirmation.
6. Phase 5: after 90 days without first-party v1 traffic, decide third-party support and deprecation. No calendar date can be set until telemetry establishes the start of that window.

## Reference heads

### Implementation progress (2026-10-08)

The isolated SDK branch now contains the first bounded Phase 1 slice: a new
server-only `@fastxyz/x402-fast` scaffold pinned to core 2.28.0, supported-network
and default-asset constants, and an upfront-only exact server mechanism. Its
28 local tests and emitting build passed. Independent specification, quality, and
constructed formal reviews passed for this bounded slice; it is committed as
`f687ff9`.

The next slice adds authoritative v2 `PAYMENT-REQUIRED` decoding to
`parse402Response`, native v2/legacy response types, and both CLI dry-run amount
formats. V2 execution remains explicitly disabled, and unsupported declared
protocol versions fail before any payment handler. Client tests (43), existing
server tests (25), existing facilitator tests (74), new mechanism tests (28), and
focused CLI tests (8) passed: 178 scoped tests in total. This does not claim the
entire CLI suite passes; an earlier broad invocation encountered native SQLite
binding failures in this scripts-disabled installation. The decoder's independent
specification, quality, and constructed formal reviews passed. The formal review
found a legacy mixed-field amount-display defect; the protocol discriminator fix
and regression tests for both versions closed it before committing.

This is not a completed mechanism: client, certificate verification, settlement,
replay integration, wrappers, releases, and live gates remain outstanding. Existing
payment wrappers have not changed behavior. Nothing has been published or deployed.

Read-only inventory of remote `main` on 2026-10-07. Check again before changing each repository. These SHAs are not assertions about deployed services.

| Repository | Main commit | Migration role |
| --- | --- | --- |
| fast-sdk | `cf40d97ac6a960497e62715bfa692e30e3f7c94c` | Mechanism, wrappers, CLI, tests |
| fast-shop-zinc | `db28326f39f0ae9db0afe84c7b5e2219976ac5fb` | Seller, shop-specific overlays, MCP bundle |
| fast-shop-shopify | `248095fc2de22a19689c0bf8d356bcaf3f2029ab` | Seller and checkout recovery |
| marketplace | `fe66955194765dab0be8f1a471bdf45a34d0ffe2` | Seller, facilitator, browser buyer; confirm live status |
| fast-mcp | `81fc3db71abaa972b65bdd4fda20cd292c4a49f2` | Buyer |
| fast-shop | `3eadbd0e7f80a936ceb54c9ad35612ac022969f5` | Hosted/widget buyers, redaction |
| pay-llm-benchmark | `26f4881bfe4f18abff2b77b778d02d8da08b7adf` | Benchmark dependency and v1 mock updates |
| fast-skill | `7dce43b250f9a5cb5d747d312c990a6a4c93decb` | Agent documentation |
| docs-pi2-network | `9ddb6d03958706c92dcf28b17749798b0f651441` | Published documentation |
| x402 | `4178ed96704010c547f0caac252b69361ab0b6fb` | Explicit fork synchronization/upstream submission |
| fastset-x402-demo | `0791924cbc0c89989d297d619f3241958d0c866c` | Archive/reuse decision |

## Expanded inventory

All four requested org code searches were executed: `@fastxyz/x402`, `X-PAYMENT`, `maxAmountRequired`, and `@x402/`. Counts varied during pagination; this is an indexed search, not a frozen or exhaustive production inventory. GitHub's default code search excludes forks, so absence does not eliminate the x402 fork.

- **acp-node** (`e4761081f6321233301b685ba7c5026bbba4f6d0`): `src/acpX402.ts` creates a v1 root scheme/network payload and sends `x-payment`; related requirements in `src/interfaces.ts` and `src/acpJob.ts`. The supplied plan excludes this fork. Record it as an explicit exception requiring an owner/usage decision, not “no x402 code.” Do not silently migrate or archive it.
- **fast-app**: package references in `README.md`, `AGENTS.md`, and `lib/discovery.ts`; no additional runtime payment handler established by this inventory.
- **fastset-h402-demo** (`e9def8dbd42e20eaf1439acf0a31d16c62a037af`): legacy h402 runtime/demo files. Remains outside the supplied x402 scope; liveness is unverified.
- **SuperTA** (`a2fbd4910d3189614c396254bed9232bab3c312d`): educational x402 examples under `cs521sp26/repos/topic-16b/`; not established production scope.
- **fast-gateway-website** (`2f05e72848b28c6c569d8f9bc22bcb02714ffb99`): `app/api/pay/route.ts` emits `X-Payment-Id` for a payment-request page, not an x402 header. Substring-search false positive; no migration inferred.

Additional paths to include in the planned migrations:

- `marketplace/apps/web/lib/browser-x402.ts` and `apps/web/components/endpoint-browser-runner.tsx`: browser buyer code as well as seller/facilitator code.
- `marketplace/patches/@fastxyz+x402-facilitator+1.0.5.patch`: an existing verifier override that must be reviewed before replacing dependencies.
- `fast-shop-shopify/src/fast-checkout-recovery.ts`, `src/schemas.ts`, and `src/payment/x402-requirement.ts`: shared requirement validation and recovery.
- `fast-shop/apps/chat/src/quote-normalizer.ts` and `packages/chat-protocol/src/index.ts`: quote/protocol boundaries as well as wallet and widget headers.
- `pay-llm-benchmark/src/mocks/x402-mock.ts`: a v1 mock remains even though the main dependencies use the Foundation SDK.

## Gate 0 findings and open decisions

- Confirmed core, fetch, and EVM 2.28.0 exist on npm. Inspect published artifacts, not only current upstream main.
- Upfront flow does not automatically verify before calling settlement; the mechanism must verify within settle.
- The resource server has no `registerV1`; compatibility must use its actual registration/supported-kind model.
- Core's pending store is not an atomic replay ledger. Establish each seller's existing durable purchase binding and whether the mechanism or merchant adapter owns consumption before implementing it.
- A fetch “recovered” result can trigger another payload creation; it is unsafe as a generic retry for an already-paid Fast request.
- Default mainnet token is fastUSD. Review the precise Fast token/decimals allowlist; never classify arbitrary Fast assets as $1 stablecoins.
- No deployed-build equivalence, marketplace liveness, seller overlay state, third-party npm usage, or archive suitability has been verified.

### Purchase binding requires a design decision

Both merchant adapters build a trusted requirement from a persisted quote, using
`resource = /orders/<quote.id>`. Their current database constraints enforce unique
quote IDs and `(payment_nonce, payer_address)` within a shared merchant database.
However, nonce/payer columns are nullable, nonce conversion uses JavaScript
`Number`, and the existing SDK does not bind the certificate to `resource`.
These constraints are not a shared certificate-consumption ledger across merchants.

References at the inventory heads:

- [Zinc requirement construction and order handling](https://github.com/fastxyz/fast-shop-zinc/blob/db28326f39f0ae9db0afe84c7b5e2219976ac5fb/src/server.ts#L443-L466).
- [Zinc replay indexes](https://github.com/fastxyz/fast-shop-zinc/blob/db28326f39f0ae9db0afe84c7b5e2219976ac5fb/migrations/001_schema.sql#L37-L38).
- [Shopify requirement builder](https://github.com/fastxyz/fast-shop-shopify/blob/248095fc2de22a19689c0bf8d356bcaf3f2029ab/src/payment/x402-requirement.ts).
- [Shopify order verification](https://github.com/fastxyz/fast-shop-shopify/blob/248095fc2de22a19689c0bf8d356bcaf3f2029ab/src/order-service.ts).

Choose the authoritative consumption owner before implementing the new mechanism:
merchant-owned durable consumption using a canonical certificate identity and trusted
quote context, or an authenticated shared facilitator ledger. A client-supplied
`extra.purchaseId` alone is not authority. Any stronger signed purchase-binding
contract also needs an explicit compatibility rule for v1 certificates that lack it.

Zinc additionally attempts a refund after unsuccessful verification using payer
information extracted from the submitted payload. Preserve neither that behavior
nor an assumption that the submitted certificate proves funds arrived. Recovery
must use verified settlement evidence. See
[the existing failure branch](https://github.com/fastxyz/fast-shop-zinc/blob/db28326f39f0ae9db0afe84c7b5e2219976ac5fb/src/server.ts#L632-L670).

Baseline verification in the isolated SDK worktree: the seven-package dependency
build passed, and client/server/facilitator unit suites passed 119 tests. These
exercise the existing v1 implementation; they do not validate the proposed v2
contract or pass Gate 1. No live transfers were performed.

## Required external evidence

Code-only work does not pass live gates. Before rollout obtain:

- authorized testnet/sepolia accounts and routes for the full Gate 1 matrix;
- proof of the deployed dual-version seller commits and shared durable replay ledger behavior;
- explicit approval for each canary purchase and its maximum amount, payer, shop, and network;
- package release credentials and approval of the exact release candidates/dist-tags;
- seven days of canary reconciliation evidence and then the 90-day first-party v1 telemetry window;
- explicit ownership decisions before archiving repositories or changing third-party compatibility.

Do not publish credentials in this ledger or request private keys in review comments. Never substitute mocked tests for the live financial gates.
