# Task — bounded exact Fast server review, 2026-10-08

Status: constructed (escalation-bounded), not machine-checked.

## Assessment

Ready for this task: Yes. No Critical or Important code findings were identified within the reviewed server-only scope. This does not approve client/facilitator/payment enablement or the entire migration. No production edits, staging or commits were made.

## Strengths and evidence

- Positive finding, exact conversion/range: `$1.000001` produces `1000001`; string prices preserve precision above JavaScript safe integer precision. Constructed VC-DECIMAL and VC-RANGE account for fractional padding, canonicalization and overflow. Direct runtime probes of money representations of 1 and M=2^256-1 returned the exact original atomic amounts; M+1 rejected. The optional-dollar upper boundary has length 80 and is accepted. No float rounding sink exists.
- Positive finding, rejected precision/grammar: existing tests reject 0.1+0.2, >6 fractions, unsafe numbers, zero, negatives, leading zeros and scientific notation. Additional direct probes rejected final newline, carriage return and Unicode line separator, plus `1.0000001`. No canonical-format counterexample found.
- Positive finding, network/flow/capability: network guard precedes lookups; enhancement guards exact scheme, matching network/version 2, upfront/absent flow, default/absent transfer method. Existing tests exercise foreign networks, unsupported flow/method, network and version mismatch. Real core resource-server integration produces upfront offers without verify/settle calls.
- Positive finding, metadata immutability: direct Object.isFrozen probes returned true for exported network array, outer asset map, both entries and nested supported-flow array. Code also freezes outer/default flow records. Caller extra fields are copied at the top level, not mutated or overwritten by facilitator extras.
- Deliberate non-finding: recipient/timeout validation remains application responsibility as documented. No client, facilitator, certificate validation, settlement or replay logic is introduced. No payment execution is implied by construction of offers.
- Deliberate non-finding: numeric conversion is exact relative to JavaScript String(number); original numeric-literal precision cannot be recovered. README instructs precision-sensitive callers to use strings. TypeScript readonly on instance fields is not runtime freezing, but the exported constants/nested metadata requested here are actually frozen.
- Lockfile/package agreement: dependency is pinned to @x402/core 2.28.0 in both manifest and importer; its snapshot resolves zod 3.25.76. Registry integrity or supply-chain provenance was not independently verified.

## Issues

Critical: none. Important: none. Minor: none.

## Verification performed

- `pnpm --filter @fastxyz/x402-fast test`: 1 test file, 28 tests passed.
- `pnpm --filter @fastxyz/x402-fast typecheck`: passed.
- Read-only direct runtime probes through `node --import tsx`: monetary [1,M,M+1] boundaries, trailing whitespace separators and frozen metadata passed expected assertions/observations.
- The first tsx CLI probe was blocked by sandbox IPC permissions; the node import path executed successfully without escalation.

Recommendation: retain tests; optionally promote the direct maximum-priced-amount and frozen-metadata probes into persistent regression cases. No test deletion is justified without actual machine checking.

## Verification limits

See SPEC.md's explicit JavaScript/core semantics escalation boundary. Claims are constructed partial correctness, not kprove results; no #Top or machine-check claim exists. Network calls, actual transfer, recipient authorization, facilitator settlement and replay safety are outside this task. Imported core is contract-only and tested by the bounded local integration, not independently formally verified. All capability limits are limits, not code findings.
