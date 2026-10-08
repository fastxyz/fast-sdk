# Release 1: additive x402 v2 compatibility

This replaces the previous Foundation mechanism/rebuild proposal in PR #184.
The scope is the four existing x402 packages in `fast-sdk`, their tests, CLI
dependency release metadata, and documentation inside this repository. No other
repository's code, lockfile, deployment, or archive status is changed here.

## Compatibility rule

A client answers in the protocol version the seller advertised. A v1-only JSON
response still produces a v1 `X-PAYMENT` request. A valid `PAYMENT-REQUIRED` v2
header takes precedence and produces a v2 `PAYMENT-SIGNATURE` request whose
`accepted` field echoes the original selected offer.

The public parsed requirement remains v1-shaped, including `maxAmountRequired`.
Additive metadata records the requested version and original v2 offer/resource.
Boundary converters map known legacy network aliases to their canonical v2 IDs.
`shortcut:` comments identify intentionally retained v1 internals. Conversion of
a client's accepted echo never replaces the seller's authoritative requirement.

Servers advertise the new header alongside the unchanged v1 body, accept either
payment header, and return both receipt headers. Fast v2 offers declare upfront
payment flow; conversion does not resubmit an already-paid certificate. Existing
certificate and EVM verification/settlement behavior stays in place. This is a
wire-compatibility release, not a replay-ledger or trust-policy redesign.

EVM v2 is restricted to EIP-3009 authorization (method and flow may be omitted or
explicitly `eip3009` / `authorization`); unsupported selected behavior fails before
money operations. Upfront Fast's certificate-derived transaction hash remains
authoritative, regardless of seller receipt metadata.

Native envelope validation requires **every** offer to use `exact` and a known
mapped Fast/EVM network. Unsupported alternatives cause whole-envelope rejection,
even alongside a supported offer. Capability-filtered negotiation is not included,
and a present native header never downgrades to the legacy body.

## Release metadata

Minor changesets target 1.1.0 for `x402-types`, `x402-client`, `x402-server`, and
`x402-facilitator`. The CLI receives a dependency/bundle patch without command
code changes. Release tooling applies the version changes; no package is
published by this PR's implementation or local tests.

There is no separate `@fastxyz/x402-fast`, core rebuild, wrapper 2.0, extension
system, new spend-control policy, upstream submission, or v1 retirement.

## Required evidence before publishing

- [x] Requirement conversion round trips, original-offer echo, receipt handling,
      and one local regression test for each money path pass.
- [x] Local legacy API regression checks pass (not a claim of completed live or
      full consumer validation).
- [ ] The actual 1.0/1.1 client/server matrix passes on Fast testnet and Base
      Sepolia. Historical 1.0 must be a genuine baseline implementation, not the new
      implementation relabeled as 1.0. Skipped/live-credential-gated tests do not pass
      this gate.
- [ ] `fast-mcp`, `fast-shop`, `fast-shop-zinc`, and `fast-shop-shopify` pass their
      own tests against local release candidates with no consumer code changes or
      merges. Production lockfiles remain unchanged.
- [ ] Live transfers are individually authorized with payer, network, route and
      maximum amount. No private keys are requested in PR comments.

External documentation, benchmark updates and demo archival listed in the
supplied plan cannot be included in a `fast-sdk` PR; they are separate follow-up
actions, not changes made by #184. Shop and marketplace implementation remains
Release 2, with merchant PRs last as requested.

Local verification: client 79 tests, server 37, facilitator 83, CLI v2 dry-run 4,
and live-harness safety 6. Consumer results and their limitations are recorded in
[`drop-in-evidence.md`](./drop-in-evidence.md). The live and complete drop-in
publishing gates above remain open.
