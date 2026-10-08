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

## Task 2 — authoritative response parser and execution guard, 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. Scope and contracts are in SPEC.md Task 2; review of uncommitted production diff against f687ff9 and the two new tests, not whole migration.

### Strengths

- Positive finding (VC-AUTH): present valid header plus invalid/empty/legacy JSON body returns the header-native v2 without reading body; present invalid header rejects without falling back. Header lookup is case-insensitive. Non-402 rejects before decode/read. Existing response tests directly assert bodyUsed=false on these paths.
- Positive finding (VC-BOUND/VC-CANON): 65536-character canonical header containing padded JSON whitespace returned native v2 with bodyUsed=false; 65540-character equivalent rejected with fixed message and untouched body in direct probes. The lexical guard runs before allocation; decoded buffer is bounded to 49152 bytes. Tests reject missing padding, whitespace, junk, nonzero pad bits (Zh==), unsupported schema/version and oversized input. Decode/re-encode equality also closes the regex end-anchor final-newline corner case.
- Positive finding (VC-ERROR): all locally invalid header and upstream decode/schema failure branches throw the constant Invalid PAYMENT-REQUIRED header, without interpolated input, cause or upstream error text. Legacy absent-header JSON failures preserve previous behavior rather than inheriting header sanitization.
- Positive finding (VC-VERSION): after parse, strict version guards precede requirement JSON logging, requirement iteration and payment handlers. Version 2 throws the specified disabled message. Explicit 3,0,null,'1' reject before execution; missing version/number 1 retain legacy dispatch. No v2 buyer, signature or payment mechanism is enabled by this task.
- Deliberate non-finding: return decoded rather than Zod-transformed output preserves native unknown fields/nulls. Structural upstream validation is not financial authorization; amount/network semantics remain outside this parser contract and payment v2 is disabled. Legacy malformed shapes are intentionally not newly validated.

### Issues

Critical under formal-code-review's proven behavioral-contract-violation mapping (display-only impact): app/cli/src/commands/pay.ts:127 chooses a field by presence rather than protocol version.

- Concrete input: absent-header legacy JSON with x402Version:1, an otherwise normal offer with maxAmountRequired:'1000' and extra amount:'999' → human output Amount:999; approved v1 display contract expects Amount:1000. Legacy JSON parsing intentionally preserves extra fields, so this is in the accepted legacy domain, not a malformed v2 input.
- Formal evidence: VC-DISPLAY fails for V=1 and hasOwn(O,'amount'); the new expression returns O.amount independently of V. Direct evaluation of the production expression on this offer returned 999. Existing v1/v2 fixtures have disjoint fields and do not expose this case.
- Why it matters: dry-run human output can disagree with the v1 execution amount; the payment path still uses maxAmountRequired. This does not enable payment or alter the JSON output.
- Recommended change: discriminate by result.paymentRequired.x402Version===2, using amount only for v2 and maxAmountRequired for legacy; add a v1 offer-with-extra-amount regression. Question for author: none; approved contract specifies the discriminator. No production edit performed by this reviewer.

Important: none beyond this finding. Minor: none.

### Verification and limits

- Direct existing Vitest 1.6 runner: packages/x402-client/tests/response.test.ts passed, 23 tests. Normal pnpm invocation was blocked by Corepack cache filesystem permission; running the already-installed runner avoided mutation/download.
- Direct Node/tsx probes confirmed encoded [65536,65540] boundary behavior and the legacy display-expression counterexample.
- CLI focused verification uses its installed root Vitest 4 runner; older package runner is incompatible with CLI's worker resolution and produced no test results. The parent reviewer can record the root runner result separately.
- Constructed proof: branch case analysis and sequential Transitivity establish AUTH, BOUND, ERROR and VERSION modulo the specified primitive contracts. DISPLAY has the concrete failed VC above. No new loop or recursion obligation arises in changed logic; no circularity is manufactured.
- [ESCALATION BOUNDARY] Buffer/base64/UTF-8/JSON, Fetch normalization, Zod and async/effect semantics remain library/JavaScript adequacy obligations, not machine proofs. Trusted base and partial-correctness scope are stated in SPEC.md. No #Top exists. Keep all tests; none can be removed on this evidence.

### Assessment

Initial assessment: With fixes. Parser and fail-closed payment control paths meet the bounded contract; correct the legacy human-amount discriminator before acceptance. Artifact path: docs/ultimatepowers/verification/2026-10-08-x402-upgrade/. No staging, commit or production edit performed by this reviewer.

### Repair re-review

The implementer changed CLI selection to enclosing paymentRequired.x402Version===2. Re-read actual diff: v2 selects amount, legacy selects maxAmountRequired, independent of conflicting extra properties. Both v1-with-extra-amount and v2-with-extra-maxAmountRequired regression fixtures now assert Amount:1000 and unchanged native JSON. The CLI root Vitest 4 focused run passed 1 file / 4 tests, including both counterexamples; this reviewer observed the completed result directly. The parent separately reports client 43/43, selected CLI 8/8, both typechecks and CLI build passing; those wider results were not independently re-run here.

Resolved finding: VC-DISPLAY closes by version case analysis; historical counterexample remains above for audit. Outstanding Critical/Important/Minor issues: none. Final readiness for this bounded task: Yes. Status remains constructed (escalation-bounded), not machine-checked; this does not approve v2 payment enablement or the full migration.
