# Release 1 — whole-branch composition proof

Status: constructed (escalation-bounded), not machine-checked. Partial correctness. Final-review/deep-mode scope: current tracked and untracked Release 1 changes against `cf40d97ac6a960497e62715bfa692e30e3f7c94c`, 2026-10-08. Existing slice claims in SPEC.md are premises. No runtime source changes, live payments or commits were made by this reviewer.

## 1. Reachability specification

Intent is the approved additive wire-compatibility Release 1 contract and docs/x402/release-1.md. Legacy runtime/certificate/replay behavior is intentionally retained. Domain: finite acyclic JSON; valid known-mapped native exact offers; supported native Fast upfront flow; valid route/config/wallet preconditions; no asynchronous concurrent mutation of caller input. Legacy custom networks remain legacy-only. For live cases, operators explicitly authorize the listed testnet payments and provision controlled separate wallets, pinned Fast testnet RPC, correct Base Sepolia RPC, trusted committee keys and bounded facilitator funds.

`O` denotes an original selected native offer, `E` a seller-authoritative expected requirement, and `S` unchanged legacy money-path state. The notation below is spec vocabulary; it does not pretend to be executable JS K syntax. The HTTP/provider boundaries are explicit open obligations.

```k
claim <k> clientServerFacilitator(R,W,C,S) => paidOutcome(R,W,C,S) ... </k>
  requires validLegacyOrNativeRequest(R) andBool existingWalletPreconditions(W)
    andBool validConfig(C) andBool nativeFastUpfrontIfApplicable(R)
  ensures answerInAdvertisedVersion(R) andBool originalOfferEchoed(R)
    andBool sellerExpectedRemainsAuthority(R)
    andBool decimalAmountPreserved(R)
    andBool noAdditionalFastSubmissionFromAdapters(R) [all-path]
claim <k> clientServerFacilitator(R,W,C,S) => errorOutcome ... </k>
  <effects> 0 => 0 </effects>
  requires invalidNativeProtocolBeforeMoney(R) [all-path]
claim <k> readLiveConfig(ENV) => null ... </k>
  <payments> 0 => 0 </payments>
  requires ENV.liveMatrix =/=K "1" [all-path]
claim <k> readLiveConfig(ENV) => safeConfiguration(ENV) ... </k>
  requires completeValidOptInConfig(ENV) [all-path]
claim <k> readLiveConfig(ENV) => error ... </k>
  <payments> 0 => 0 </payments>
  requires optedIn(ENV) andBool notBool completeValidOptInConfig(ENV) [all-path]
claim <k> requireMatrixGate(ENV,N) => .K ... </k>
  requires ENV.liveMatrix ==K "1" andBool N ==Int 8 [all-path]
claim <k> requireMatrixGate(ENV,N) => error ... </k>
  requires ENV.liveMatrix =/=K "1" orBool N =/=Int 8 [all-path]
claim <k> matrixCase(Q,C) => confirmedCase(Q,C) ... </k>
  requires safeConfiguration(C) andBool providersSatisfyBoundaryContracts
  ensures paymentCalls ==Int 1 andBool recipientDelta ==Int 1000
    andBool hashIndependentlyConfirmed andBool expectedWireHeaderObserved [all-path]
```

The final matrixCase claim is conditional partial correctness: a failing provider/assertion may produce a failure instead, never a certified success. The fixed suite has eight cases and zero configured harness retries; the provider internals are not a new exactly-once/replay proof. A fixed-case-run bound is not a lifetime budget across reruns/refills. Fast fees and EVM gas are additional; documentation explicitly requires separately limited wallets.

## 2. Circularities

Reuse JSON structural equality and finite offer/config/discovery scan circularities in SPEC.md. Closest shape 09 is a relational finite fold; shape 13 covers recursive JSON. Preserve checked prefixes and untouched metadata; no numeric payment conversion is introduced.

For registration of the two-network/four-pair matrix and completion counting:

```k
claim <k> registerCases(A,I,L) => registered(A,L) ... </k>
  requires 0 <=Int I andBool I <=Int size(A)
    andBool registeredPrefix(A,I,L) [all-path]
claim <k> runCases(A,I,N) => runResult(A,I,N) ... </k>
  requires 0 <=Int I andBool I <=Int 8
    andBool N <=Int I andBool confirmedPrefixCount(A,I,N) [all-path]
```

Each finite registration iteration performs a real iterator/closure creation step, appends precisely its network/pair case and advances. Execution is sequential; after successful postconditions, `completed++` adds exactly one. A failed case never increments. Reusing the suffix claim is guarded by an actual case execution, not Reflexivity. Empty suffix terminates registration; only N=8 satisfies the release gate. Vitest scheduling/hook semantics are an explicit API boundary, not a machine-encoded theorem.

## 3. Informal composition proof

For native offers, header precedence selects PAYMENT-REQUIRED before reading the body. Strict bounded canonical base64/JSON validation either rejects, with no wallet effect, or yields an envelope. fromV2 produces detached legacy-shaped fields and snapshots while preserving decimal strings and metadata. The selected snapshot is checked against normalized terms, resource and original-envelope membership before either payment handler signs, bridges or submits. Protocol serialization uses the original selected offer rather than reconstructing it. Consequently the client answers in the seller's advertised version and preserves native accepted identity as JSON.

The server chooses PAYMENT-SIGNATURE before X-PAYMENT. Malformed or wrong-version native values return 402, never fallback. Its authoritative route requirement supplies expected terms to fromV2PaymentPayload before facilitator HTTP effects. Successful normalization carries the original certificate/authorization into the legacy payload; it does not replace seller amount/payTo/asset with payer values. Facilitator native input independently checks supported Fast upfront flow and accepted/expected equality before its legacy verifier/settler. Alias selection changes runtime lookup key only; canonical comparison keeps the same network identity. Mismatched/unsupported values return before provider effects. Transitivity composes both independent guards with the unchanged sensitive path contracts.

Fast adapters introduce no new submission: client retains its preexisting submit operation, seller success returns before settlement, and direct facilitator settlement remains verify/hash-only. EVM retains its existing authorization/settlement behavior. Native receipt mapping retains hash/payer and canonicalizes mapped network; legacy receipt remains present. Unknown custom legacy networks skip only native advertising/receipt conversion. Client receipt presentation cannot erase a known Fast local hash when native transaction is absent. Thus legacy behavior and native wire boundary contracts compose within the stated domain. ∎

Live safety composes separately: ordinary config excludes live files; readLiveConfig returns null without opt-in, and enabled incomplete/unsafe configuration throws before case bodies. Each enabled case checks Base chain ID, decimals, controlled distinct recipient and facilitator balance ceiling before `pay`. Fast testnet is pinned to SDK URL and independently trusted committee keys are operator-supplied. No bridge configuration is passed. A case uses one pay call and confirms one paid request header, payment result, matching certificate/receipt hash and exact recipient increment before incrementing completed. Wrong/missing live gate state throws rather than treating skipped cases as release evidence. ∎

## 4. Machine-detailed construction / VCs

Rules used are the reused mini-imperative assignment/lookup/guard/return Axioms; Case Analysis on guards; framing of untouched terms; Consequence for equality and index arithmetic; Transitivity across previously stated contracts; guarded Circularity on finite prefix scans. No SMT or K toolchain was run.

| VC | Discharge / remaining obligation |
| --- | --- |
| Present invalid native requirement implies no body fallback or wallet operation | Immediate throw/return branch, constructed Case Analysis. |
| Selected original offer/resource remain equal through alias config resolution | Canonical network equality plus framed snapshots; structural JSON equality induction is escalation-bounded. |
| Accepted mismatch cannot reach legacy verifier/settler | Guard failure and immediate wrapper/middleware return; constructed. |
| Native unsupported Fast flow cannot be treated as upfront | Expected and accepted guards in normalizePayment; supported native client guard; constructed. |
| Legacy-only custom network does not require canonical receipt mapping | Guarded catch suppresses only new native header; constructed. |
| Decimal protocol amounts stay strings across JSON HTTP and normalization | No generic numeric-string reviver; property copying; API JSON semantics obligation. |
| Ordinary test configuration cannot activate money cases | Exclusion of both live-matrix and standalone fast-payment files; no dotenv loading; configuration source inspection and offline test evidence. |
| Missing matrix opt-in cannot pass live release gate | Explicit pre-suite requireMatrixGate plus afterAll completion check; executed negative command exits 1. |
| Invalid config throws before case closure execution | readLiveConfig evaluated before registration; constructed. |
| N successful cases means N independently confirmed 1000-unit recipient increments | Increment occurs only after assertions; finite prefix circularity; provider/balance authenticity remains external. |
| Genuine published baseline is distinct from workspace candidate | npm alias lock resolutions pin client 1.0.10 and server 1.0.1 rather than workspace links; installed historical Fast body inspected. |
| Full runnable JS/HTTP/provider K artifacts faithfully encode these units | [ESCALATION BOUNDARY], outside mini-imperative fragment; none emitted. |

## 5. Findings

No unresolved concrete in-domain counterexample found in final revision. The initial unsupported-native-Fast-flow finding is resolved as recorded in FINDINGS.md. Runtime tests establish local examples, not universal formal verification or historical live compatibility. Consumer evidence and live matrix remain accurately labeled partial/pending. Release metadata and deletion of the abandoned extra-package/rebuild documentation add no formal program content; approved scope preserves four existing public packages and CLI command behavior.

## 6. Test retention and verification limits

Keep all boundary, integration and safety tests. No test deletion is proposed. No #Top exists, so no machine-check-based redundancy claim is made.

[ESCALATION BOUNDARY] Full TypeScript object/prototype, Fetch/Express, Buffer/JSON/clone, asynchronous scheduling/Vitest hooks, recursive JSON induction, viem account derivation, provider/certificate/signature/chain authenticity and all live financial outcomes are not encoded here. Existing money/replay/trust paths remain contract-only. Open obligations: a faithful runnable semantics and actual solver/toolchain proof, plus separately authorized on-chain matrix and complete versioned downstream release-candidate checks. Trusted base: fragment adequacy, reachability metatheory and elementary first-order/map simplification reasoning; no solver result is claimed.

Reproduction of the *local evidence*, with spending opt-ins explicitly absent:

```sh
env -u X402_LIVE_MATRIX -u X402_LIVE_FAST pnpm --filter @fastxyz/x402-e2e test
pnpm --filter @fastxyz/x402-e2e build
env -u X402_LIVE_MATRIX -u X402_LIVE_FAST pnpm --filter @fastxyz/x402-e2e test:live-gate
```

The last command must fail with missing-opt-in error; that is safety evidence, not a passing live release gate. There are deliberately no invented kompile/kprove commands: these artifacts are a constructed proof with specified semantics gaps, not runnable K files.

## 7. Receiving-review correction and strengthened proof — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. This amendment supersedes the earlier omitted selector obligation and too-weak Fast receipt fallback statement for fixes against `8dc921af1438f7319c77ea52913edaa63035428e`. The independent counterproofs in the separate PR review FINDINGS are valid: echo preservation alone does not prove that the signed mechanism matches reserved EVM selectors, and preservation only when receipt hash is absent does not prove local Fast identity authority.

F1 construction: native original snapshot/normalized equality and envelope membership are checked first. Canonical eip155 classification then inspects selected extra. Case Analysis splits method absent/eip3009 vs any other present value, then flow absent/authorization vs any other present value. Unsupported branches throw. Because handleEvmPayment's first statement is the validator call, Transitivity reaches that throw with account/provider/signing/bridge state framed unchanged; this also closes the insufficient-EVM-balance/funded-Fast-bridge witness. Supported branches return and compose with unchanged EIP-3009 body; unknown unrelated metadata is not stripped. Legacy version 1 returns from validation before these new guards. No total-provider-correctness proof is inferred.

F3 construction: after the existing provider succeeds and local certificate hash H is established, response parsing does not overwrite H. The returned payment object assigns its txHash directly H and network directly fastReq.network. By framing and direct assignment, any native/legacy seller receipt H2, wrong network, failure flag or empty transaction is irrelevant to those fields, for both paid HTTP 200 and 402 outcomes. HTTP status still controls SDK success as before; an unsuccessful HTTP response remains unsuccessful, while its payment identity is retained. The existing CLI's success guard and recorded p.txHash now compose with H rather than receipt H2. No receipt trust policy or chain replay redesign is needed.

| Strengthened VC | Disposition |
| --- | --- |
| Unsupported native EVM selector cannot reach any account/provider/sign/bridge body operation | Constructed by first-statement call and guard throw; six rejection regression rows pass. |
| Supported omitted/explicit EIP-3009+authorization still echoes original and reads EVM settlement receipt | Constructed supported branch + unchanged EVM serialization/receipt path; both regression controls pass. |
| Seller receipt cannot replace submitted Fast certificate hash/network | Constructed direct assignment and frame; four version/status conflict cases plus existing receipt variants pass. |
| Unsupported unselected native network/scheme alternative rejects whole envelope | Unchanged whole-envelope validator; now explicit accepted public interoperability restriction, no wider negotiation theorem claimed. |

Final independent local evidence: client 7 files / 79 tests passed. No runtime source changes/live payments/commits by this reviewer, no machine proof. Trusted base and escalation obligations remain those in §6. No unresolved blocking fix finding established.

## 8. Authorized harness RPC-trust domain change — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. Harness diff against develop `a150bd5`. User-approved intent changes the harness trust precondition from independently provisioned committee membership to trusting the pinned official Fast testnet RPC. Earlier §1/§3 and SPEC committee-key assumptions are superseded for this harness; no production verifier correctness theorem is extended. `committeePublicKeys: []` selects an existing production warning/RPC-trust path and does not independently authenticate validator membership.

Configuration construction deletes only committee parsing/required-key guards and its returned field; all spending opt-in, endpoint, distinct controlled wallets and bounded gas funding guards remain. Thus complete new-domain config without committee keys reaches its config return, while absent opt-in still reaches null and unsafe remaining inputs still throw before case execution. Neither ordinary configuration loads live files or dotenv.

Case construction frames all existing mandatory matrix assertions. Separate provider.getTransactionCertificates must return one certificate matching payer sender and nonce; BCS-domain recomputation must equal the local payment hash; final recipient balance must differ by exactly 1000. Case Analysis on an RPC rejection, missing certificate or assertion failure reaches rejected test body before `completed++`. finally performs server cleanup, not success counting. No catch converts those failures to a skip or success. An optional verifier-side RPC failure can be tolerated by unchanged production behavior, but cannot discharge the separate case-level confirmation obligation. Transitivity through pay → certificate/hash → balance → increment proves successful cases are RPC-trust-confirmed; the existing finite prefix circularity then permits the release gate only at eight confirmed completions. No newly introduced loop/circularity is needed. ∎

This proof is conditional on the trusted RPC reporting authoritative network data. Separate lookup and local hash computation are independent operations, not independent trust roots; same-RPC forged certificate/balance is explicitly outside that assumption. Confirmation is postpayment and failures cannot promise no funds were spent. Actual availability, authenticity, timing and all eight live outcomes remain open external obligations. The older standalone suite is not a publication gate. Offline suite/typecheck evidence is retained separately; no live invocation, runnable K semantics, solver or #Top result exists.
