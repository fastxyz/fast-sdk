# Release 1 — client/types formal review

Status: constructed (escalation-bounded), not machine-checked. Partial correctness; per-task diff-scoped review against `cf40d97`, including untracked adapter/test files.

## Strengths / positive findings

| Contract / branch | Concrete evidence | Classification |
| --- | --- | --- |
| Header precedence | Valid v2 header plus invalid/legacy body → normalized v1-shaped fields and untouched body; expected same. Invalid or oversized/noncanonical header plus valid body → error, no fallback; expected same. | positive finding |
| Answer in kind | Legacy seller → X-PAYMENT/version 1; native seller → PAYMENT-SIGNATURE/version 2 with selected accepted/resource JSON preserved, including unknown nested metadata. | positive finding |
| Pre-money guard | Missing original metadata, mutated amount/payTo/asset/network/extra, or Fast flow absent/authorization/deferred → rejection before any RPC/bridging/submission. Validation is first statement in both payment handlers. | positive finding |
| Receipt fallback | Native receipt transaction empty/undefined/non-string → no receipt hash; Fast retains known local hash through nullish fallback. A valid native transaction or legacy txHash is exposed. | positive finding |
| Config alias | Native eip155:11155111 → normalized ethereum-sepolia → caller sepolia config selected canonically; original accepted offer still echoed. | positive finding |
| Additive converters | Native amount 9007199254740993123 remains a string; unknown metadata survives fromV2/toV2 roundtrip. Prototype names constructor/__proto__ are rejected as unknown mappings. | positive finding |

## Proof construction / verification conditions

Case Analysis discharges present/absent header and v1/v2 branches. Transitivity composes native validation → detached normalization → original consistency guard → existing money path contract → native/legacy payload serialization. Framing carries original native values and unrelated state through normalization. For Fast unsupported-flow branches, the initial validator throws before the first sensitive call, so effects remain zero.

| VC | Disposition |
| --- | --- |
| Header present implies body-read branch unreachable | Constructed by the immediate return/throw branch structure. |
| v2 accepted terms equal original selected offer | Constructed: normalized field equality, membership and resource guards precede toV2PaymentPayload; payload uses original objects rather than reconstruction. |
| Canonical config alias preserves requested offer | Constructed: only runtime network key is rewritten; assertOriginal compares canonical network identifiers. |
| Invalid Fast paymentFlow implies no money effects | Constructed by first-statement validator and guarded body sequencing. |
| Undefined receipt hash cannot erase local Fast hash | Constructed by nullish fallback. |
| JSON recursion and finite scans preserve structural equality/order | Concrete branch analysis plus tests; universal structural-induction/API-semantics obligation is escalation-bounded. |

## Issues

Critical: none found. Important: none found. Minor: none found in this scope. No concrete in-domain counterexample to the approved changed-unit contract was established.

## Deliberate non-findings

Known-only CAIP mapping is Release 1's documented boundary, not generic chain support. Existing certificate verification, replay policy, bridge settlement and spend controls are intentionally unchanged and are not treated as new defects. CLI production pay.ts currently has no diff versus the base; retaining maxAmountRequired makes unchanged CLI dry-run formatting compatible. These findings do not certify live publishing gates.

## Executed evidence

`pnpm --filter @fastxyz/x402-client test` passed: 7 files / 67 tests, 2026-10-08. New adapters, protocol, Fast protocol and response regression suites were included. No live transactions or runtime source edits were made.

Targeted CLI command `pnpm exec vitest run tests/commands/pay-dry-run-v2.test.ts` from app/cli passed: 1 file / 4 tests. An earlier package-script invocation with a separator did not constrain the test selection, exposed unrelated existing SQLite-dependent failures, and was interrupted; it is not claimed as a passing full CLI suite.

## Verification limits

[ESCALATION BOUNDARY] Full JS/TS object semantics, Fetch/Buffer/JSON/clone behavior, asynchronous concurrency and recursive JSON induction are not encoded or machine-checked. Existing wallet/provider/signature/bridge functions are contract-only. Open obligations and assumptions are specified in SPEC.md. Trusted base: fragment adequacy, reachability metatheory, first-order/map simplification reasoning. No K toolchain or SMT solver was run; tests are not a proof upgrade.

## Assessment

Ready for this scoped review: yes; no blocking client/types finding established. Status: constructed (escalation-bounded). This does not replace actual historical 1.0/1.1 testnet matrix, downstream consumers, or separately authorized live transfer evidence required before publishing.

## Task server/facilitator — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. Partial correctness; server/facilitator per-task diff against `cf40d97`, including untracked normalize/tests. No runtime source edits, commits, live payment calls or transfers.

### Strengths / positive findings

| Contract / branch | Concrete input → observed vs expected | Classification |
| --- | --- | --- |
| Seller authority | Native accepted amount `1` against server amount `100000`, or accepted payTo attacker against facilitator seller → rejection before facilitator/legacy verification respectively; expected rejection. | positive finding |
| Native precedence | Malformed native header or native-header v1/v3 plus valid legacy header → 402, no facilitator call/no next; expected no downgrade. | positive finding |
| Fast upfront | Native Fast success → one verify call, no settle call, both receipts; direct Fast settlement remains verification/hash-only, no chain resubmission. | positive finding |
| Receipts and custom legacy | Mapped native EVM success → both receipt formats with same hash/payer and canonical native network; unmapped custom v1 success → legacy receipt retained and no bogus native receipt. | positive finding |
| Decimal strings | Encoded native amount/authorization `90071992547409930000` → JSON strings retained, valid EVM verify/settle mock success, conversion to BigInt only at existing contract call. | positive finding |
| Discovery | Configured sepolia/Fast entries plus valid EVM key → old paymentKinds preserved, mapped canonical kinds added, upfront on Fast, signer equals derived EVM account, extensions empty. | positive finding |

### Proof construction / verification conditions

Case Analysis splits native/legacy, mapped/unmapped, valid/mismatched, verify success/failure and Fast/EVM branches. Transitivity composes authoritative requirement creation → accepted equality guard → payload normalization → unchanged legacy verification/settlement → answer-in-kind receipt mapping. Framing retains payload authorization/certificate and trusted seller fields, including decimal strings. No extra transaction effect is introduced by normalization or receipt conversion.

| VC | Disposition |
| --- | --- |
| Mismatch cannot reach legacy sensitive body | Constructed: normalizer throws, wrapper catches and immediately returns mismatch verdict; middleware parse catches and immediately returns 402. |
| Native cannot fall back to legacy | Constructed: nullish header selection and native branch return/throw path; malformed/wrong version never reselects X-PAYMENT. |
| Native requirement uses configured canonical alias without trusting accepted | Constructed: expected alone creates normalized requirement; finite configured-key search changes only network key; accepted is compared afterward. |
| Fast success cannot reach settlement statement | Constructed by early next return and unchanged verify/hash-only Fast facilitator branch. |
| Custom legacy cannot fail only because native mapping is unavailable | Constructed: advertising and receipt conversion catch unmapped network and preserve legacy paths. |
| Discovery fold retains all old kinds and maps only eligible new kinds | Constructed prefix-fold/first-match circularity; callback exceptions skip only native item. |
| JSON protocol strings retain exact decimal values | Constructed from removal of generic bigint reviver; JSON parse and converters preserve string fields; mocked valid EVM HTTP tests exercise both endpoints. |

### Issues

Critical: none found. Important: none found. Minor: none found in this scope. No concrete in-domain counterexample to the approved changed-unit contract established.

### Deliberate non-findings / recommendations

Legacy unknown custom networks are deliberately v1-only and remain usable. Seller-supplied expected terms remain the direct facilitator authority; the adapter is not a new replay/trust-policy layer. Existing cryptographic verification, certificate trust and EVM settlement are unchanged contracts, not independently certified here. Keep existing integration and boundary tests; no test removal is recommended. Publishing still requires the separate actual historical-client/testnet and downstream-consumer gates.

### Executed evidence

`pnpm --filter @fastxyz/x402-server test` passed: 4 files / 34 tests. `pnpm --filter @fastxyz/x402-facilitator test` passed: 5 files / 80 tests. Executed 2026-10-08 with untracked server v2, facilitator v2 and valid EVM v2 mock suites included. No live network payment evidence is claimed.

### Verification limits and assessment

[ESCALATION BOUNDARY] Full TypeScript/Express/HTTP, asynchronous scheduling, object aliasing, structural equality induction, crypto/address derivation and provider behavior are not encoded/machine-checked. Open obligations and trusted base are recorded in the matching SPEC section. No #Top or SMT solver result exists; tests do not upgrade proof status.

Ready for this scoped review: yes; no blocking server/facilitator finding established. Status: constructed (escalation-bounded), partial correctness. This is not publishing authorization or evidence of the external release matrix.

### Follow-up supported-flow guard — resolved during review

The clarified approved contract supports only upfront native Fast flow. Before the implementer's concurrent guard change, a correct trusted Fast certificate with identical seller expected and payer accepted native `extra.paymentFlow: "deferred"` would pass: fromV2 retains original extra, toV2(expected) returns that original, accepted equality succeeds, and the unchanged valid legacy verification receives the same certificate. Observed by constructed source-path composition; no pre-fix runtime replay was performed. Expected: reject unsupported native flow before the legacy provider path. Classification: proven wire-contract violation / needed code guard (Critical under formal-code-review mapping), now resolved rather than an outstanding issue.

Final normalize.ts checks both native expected Fast flow and native accepted Fast flow before conversion/verification; `deferred`, `authorization`, and absent flow reject, including legacy payload with native unsupported expected terms. Added valid-certificate regressions establish legacy and native upfront still succeed, unsupported flows fail verify and settle, and mocked fetch is not called after rejection. No runtime code was edited by this reviewer. The scoped assessment applies to this guarded final revision, not the pre-guard snapshot.

Post-guard executed evidence: `pnpm --filter @fastxyz/x402-facilitator test` passed, 5 files / 83 tests (verify suite now 34 tests), 2026-10-08. This supersedes the earlier 80-test facilitator result for the final guarded revision.

## Final whole-branch composition — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. Partial correctness. Whole current tracked/untracked Release 1 change against main `cf40d97ac6a960497e62715bfa692e30e3f7c94c`; full construction in PROOF.md.

### Strengths

Client native-header authority → detached original selected offer → pre-money consistency/upfront guard → answer-in-kind payload composes with server native-header priority → seller expected comparison → facilitator supported-flow/equality guard → unchanged money paths → dual receipts. Decimal string and canonical network identities survive each boundary. The previously found unsupported native Fast flow is resolved in this final revision; no additional submission is introduced.

The final ordinary e2e configuration excludes both live test files. Matrix configuration requires explicit opt-in rather than credentials alone, uses pinned testnet and distinct controlled wallets, checks chain/decimals/bounded gas funds before payment, and provides zero harness retries/no bridges. Genuine npm baseline aliases remain separate from workspace candidate code. Completion increments only after correct wire header, paid content, independent hash confirmation and exact recipient delta assertions. Missing opt-in fails the explicit gate, not a disguised pass.

### Issues

Critical: none unresolved. Important: none unresolved. Minor: none established. No concrete in-domain counterexample found against the approved final wire/safety contract. Missing actual live/downstream completion is an accurately disclosed publishing prerequisite, not a hidden claim or inferred implementation bug.

### Executed evidence

Independently rerun with live opt-ins explicitly unset: client 7 files / 68 tests, server 4 / 34, facilitator 5 / 83, and ordinary e2e 1 / 6 safety tests all passed. Harness `build` (`tsc --noEmit`) passed. Explicit unopted live-gate command exited 1 with `X402_LIVE_MATRIX=1 is required for the release gate` before any case execution, as expected. `git diff --check` passed. No live payments occurred; neither gate completion nor on-chain compatibility is claimed.

### Recommendations / verification limits

Retain the tests. Before publishing, separately record eight actually authorized live matrix successes and all required versioned downstream candidate checks. Local consumer evidence remains partial as docs/x402/drop-in-evidence.md states. Existing trust/replay/crypto paths are deliberately not redesigned.

[ESCALATION BOUNDARY] Full TS/HTTP/async/Vitest, structural JSON induction, crypto/address derivation and provider/chain semantics are open obligations in PROOF.md; runnable K emission is not faithful within this fragment and none is fabricated. Trusted base: fragment adequacy, reachability metatheory, elementary first-order/map reasoning. No K toolchain, SMT run or #Top exists.

### Assessment

Ready to merge the reviewed implementation: yes, no unresolved blocking formal finding. Ready to publish: not established; live and versioned downstream gates remain pending. Durable artifacts: SPEC.md, FINDINGS.md, PROOF.md in this directory. Status: constructed (escalation-bounded), not machine-checked.

## Receiving-review fixes F1/F3 and restriction F2 — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked; partial correctness. Uncommitted fix diff against exact reviewed head `8dc921af1438f7319c77ea52913edaa63035428e`. Independent FINDINGS at `/private/tmp/fast-sdk-pr184-formal-20261008/docs/ultimatepowers/verification/2026-10-08-x402-v2-compatibility/FINDINGS.md` were read completely. Its F1/F3 concrete counterexamples are valid corrections to the earlier proof scope: omitted EVM selector validation could reach the old EIP-3009/bridge body under a Permit2 accepted echo, and Fast receipt fallback preserved H only when no receipt hash existed, not when an attacker supplied H2. Prior positive receipt wording was too weak for identity authority. No claim that the earlier approvals disproved these witnesses is made.

| Finding | Pre-fix counterexample | Final fix / evidence | Disposition |
| --- | --- | --- | --- |
| F1, operational P2; formal Important needed guard | Valid native Base offer selects Permit2; validator returns, old EIP-3009 signing/optional bridge executes instead. | Native selected method must be omitted/eip3009 and flow omitted/authorization. Validator remains the EVM handler's first statement; unsupported values throw before account/provider/sign/bridge. Six rejection rows and omitted/explicit supported controls pass. | resolved |
| F3, operational P2; formal Critical changed-unit identity violation | Local submitted certificate H plus seller success/failure receipt H2 → SDK reports H2; HTTP 200 permits existing CLI history to use it as confirmed. | Fast result always sets txHash to local H; receipt helper removed from Fast handler. Conflicting failure hash/network tests pass for both versions and HTTP 200/402; SDK network remains the normalized Fast requirement. | resolved |
| F2, P3 intent/interoperability restriction | Supported exact/Base option plus well-formed Solana or upto alternative → entire envelope rejected despite supported option. | Release/client/types docs explicitly state every offer must be exact and known-mapped, unselected unsupported alternatives reject the whole header, and no legacy fallback occurs. No negotiation expansion promised or implemented. | documented accepted restriction |

Proof evidence: original consistency and canonical EVM classification → selector guard → throw is a Case Analysis path with zero effects. The first handler statement ensures no body effect can precede it, independent of available balances/bridge arguments. Supported paths retain exact accepted echo and existing EIP-3009 body. Fast output assignment is direct H, so framing makes receipt contents irrelevant to hash/network identity. No new loop, recursion or trust/replay mechanism is introduced. Full JS/async/provider/library semantics remain explicit escalation boundaries; no K/SMT/#Top exists.

Executed by this reviewer: `env -u X402_LIVE_MATRIX -u X402_LIVE_FAST pnpm --filter @fastxyz/x402-client test` passed, 7 files / 79 tests; protocol suite 25, Fast protocol suite 7. Main's reported ten pre-fix RED assertions are not independently rerun here; the independent counterproofs and before/after source traces establish the pre-fix issue, and this reviewer ran the final green suite. Keep all tests. No live payments, runtime code edits or commits were made by this reviewer.

Assessment: approved fix diff; no unresolved concrete F1/F3 gap found. F2 is documented rather than functionality-expanded, matching accepted scope. Publication live/versioned-consumer gates remain pending. Status: constructed (escalation-bounded), not machine-checked.
