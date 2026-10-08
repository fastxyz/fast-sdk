# Release 1 — client/types diff-scoped contracts

Status: constructed (escalation-bounded), not machine-checked. Partial correctness.

Review base: `cf40d97`; current tracked working changes and untracked v2 adapters/tests are included. Per-task mode, no runtime edits or live transfers. Intent is the approved additive Release 1 contract and `docs/x402/release-1.md`. CLI production `pay.ts` is unchanged versus the base; its added dry-run tests are compatibility evidence, not a changed production unit.

## Domain and fragment

`J` is a finite, acyclic JSON value, `O` a valid exact offer using the explicit known network map, `R` a resource object, and `E` a v2 envelope with nonempty accepts. Unknown network identifiers are rejected deliberately. `legacy(O,R)` preserves amount as a string, canonical payment terms, and detached original offer/resource snapshots. The legacy body domain and wallet/chain preconditions are unchanged. Caller objects are not concurrently mutated during an asynchronous payment.

Closest shapes: catalog 09 (finite search/relational results) and 13 (JSON recursive values). For ordinary assignments, conditions, property reads, and finite iteration, use the existing mini-imperative Axiom, Case Analysis, framing, and Transitivity rules. JSON/HTTP/TypeScript operations below are **spec vocabulary and boundary contracts**, not invented runnable K semantics:

```k
// Fragment sketches: actual JS object/HTTP semantics remain an escalation.
rule <k> if true then A else B => A ... </k>
rule <k> if false then A else B => B ... </k>
rule <k> assign(X,V) => .K ... </k> <store> S => S [ X <- V ] </store>
rule <k> return(V) ~> CONT => V ~> CONT </k>
// call binds arguments; property lookup reads; spread creates a shallow object;
// finite map/find/some iterate in input order; throw prevents later effects.
```

HTTP Headers lookup is case-insensitive; Buffer encodes standard base64; JSON parse either yields J or throws; structuredClone creates detached JSON snapshots. These are documented operational assumptions, not machine-proved axioms. Existing provider/signing/bridging functions enter contract-only: after valid inputs they return their existing result or reject; their financial/certificate correctness is not re-proved.

## Function claims

Below `error` denotes rejection/throw before subsequent statements, `effects` counts sensitive signing/bridging/submission calls, `orig` denotes the unchanged original native JSON value, and continuation/store frames are implicit where untouched.

```k
claim <k> equalPaymentMetadata(A,J) => jsonEqual(A,J) ... </k>
  requires finiteJson(A) andBool finiteJson(J) [all-path]
claim <k> toCanonicalNetwork(N) => canonical(N) ... </k>
  requires knownAliasOrCanonical(N) [all-path]
claim <k> toLegacyNetwork(N) => firstLegacyAlias(N) ... </k>
  requires knownAliasOrCanonical(N) [all-path]
claim <k> validateV2Requirement(O) => .K ... </k>
  requires validOffer(O) [all-path]
claim <k> validatePaymentRequiredV2(E) => .K ... </k>
  requires validEnvelope(E) [all-path]
claim <k> fromV2(O,R) => legacy(O,R) ... </k>
  requires validOffer(O) andBool finiteJson(R) [all-path]
claim <k> assertOriginalV2Requirement(L) => .K ... </k>
  requires validOriginal(L) andBool termsEqual(L,orig(L)) [all-path]
claim <k> toV2(L) => orig(L) ... </k>
  requires validOriginal(L) andBool termsEqual(L,orig(L)) [all-path]
claim <k> toV2(L) => nativeTerms(L) ... </k>
  requires noOriginal(L) andBool validLegacy(L) [all-path]
claim <k> fromV2PaymentPayload(P,L) => legacyPayload(P.payload,L.network) ... </k>
  requires P.version ==Int 2 andBool acceptedMatches(P.accepted,L) [all-path]
claim <k> toV2PaymentPayload(P,O,R) => nativePayload(2,O,P.payload,R) ... </k>
  requires validOffer(O) [all-path]
claim <k> toV2SettleResponse(S) => nativeReceipt(S) ... </k>
  requires validLegacyReceipt(S) [all-path]
claim <k> getNetworkType(N) => fast ... </k>
  requires startsFastDashOrColon(N) [all-path]
claim <k> parse402Response(H,B) => legacy(decoded(H)) ... </k>
  requires status402 andBool present(H) andBool canonicalBoundedV2(H)
  ensures notBool bodyConsumed(B) [all-path]
claim <k> parse402Response(H,B) => error ... </k>
  requires status402 andBool present(H) andBool notBool canonicalBoundedV2(H)
  ensures notBool bodyConsumed(B) [all-path]
claim <k> parse402Response(absent,B) => parsedLegacyBody(B) ... </k>
  requires status402 andBool validLegacyBody(B) [all-path]
claim <k> validateRequestedProtocol(E,L) => .K ... </k>
  requires legacyVersion(E) orBool consistentV2(E,L) [all-path]
claim <k> validateRequestedProtocol(E,L) => error ... </k>
  <effects> 0 => 0 </effects>
  requires notBool (legacyVersion(E) orBool consistentV2(E,L)) [all-path]
claim <k> requestedPaymentPayload(E,L,P) => answerInKind(E,L,P) ... </k>
  requires legacyVersion(E) orBool consistentV2(E,L) [all-path]
claim <k> readPaymentReceipt(H) => optionalReceipt(H) ... </k>
  requires finiteHeader(H) [all-path]
claim <k> resolveEvmNetworkConfig(N,C) => firstEquivalentConfig(N,C) ... </k>
  requires finiteConfig(C) [all-path]
claim <k> x402Pay(P) => paymentResult(P) ... </k>
  requires existingWalletPreconditions(P) andBool consistentAdvertisedProtocol(P)
  ensures headerVersionMatchesSeller(P) andBool exactSelectedOfferEcho(P) [all-path]
claim <k> handleFastPayment(E,L,W) => fastResult(E,L,W) ... </k>
  requires existingFastPreconditions(W,L) andBool consistentProtocol(E,L)
  ensures headerVersionMatchesSeller(E) andBool exactSelectedOfferEcho(E,L)
    andBool knownHashPreservedWhenReceiptHashAbsent [all-path]
claim <k> handleEvmPayment(E,L,W,C) => evmResult(E,L,W,C) ... </k>
  requires existingEvmPreconditions(W,L,C) andBool consistentProtocol(E,L)
  ensures headerVersionMatchesSeller(E) andBool exactSelectedOfferEcho(E,L) [all-path]
```

`consistentV2` requires preserved original offer, normalized term equality, original envelope membership, resource equality, and `extra.paymentFlow == "upfront"` for Fast. `answerInKind` uses X-PAYMENT/version 1 for legacy and PAYMENT-SIGNATURE/version 2 for native, preserving original accepted/resource JSON values. Receipt parsing uses PAYMENT-RESPONSE first, then X-PAYMENT-RESPONSE when the native header is absent. A malformed receipt is optional metadata and cannot erase the locally known hash.

## Circularities and side conditions

The JSON equality recursive claim above is generalized over both finite values; each recursive descent follows a real property/array-element lookup and call step. Arrays preserve ordering, object keys are compared as sets with own-property checks. Structural induction needed to lift this to all finite JSON is an explicit escalation boundary.

Finite iteration claims (map, every, some, find, Object.entries loop) preserve the checked/converted prefix and advance its index:

```k
claim <k> scan(A,I,S) => scanResult(A,I,S) ... </k>
  requires 0 <=Int I andBool I <=Int size(A)
    andBool correctPrefix(A,I,S) [all-path]
```

Instantiate separately for offer validation/normalization, object-key equality, canonical-to-alias search, original offer membership, and config alias lookup. Exit is empty remaining suffix; the body advances one element after lookup/guard, earning circularity guardedness. Earliest match returns immediately. Canonical config exact-key matching precedes alias scanning. No numeric accumulation, rounding, or payment amount Number conversion is introduced by these adapters.

## Open obligations

[ESCALATION BOUNDARY] Full TypeScript objects/prototypes, Fetch Response consumption, asynchronous scheduling, Buffer/JSON UTF-8 semantics, structuredClone, and recursive JSON induction exceed the mini-imperative fragment. Provider/network availability and cryptographic/certificate correctness stay contract-only. No runnable K artifact or #Top result exists; live historical-client/server and downstream-consumer gates remain separate. Trusted base: fragment adequacy, reachability metatheory, and first-order/map simplification reasoning; no solver was run.

## Task server/facilitator — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. Partial correctness; per-task review against `cf40d97`, including untracked normalize.ts and v2 tests. Approved Release 1 intent, not an as-built replacement contract. Changed units: createPaymentRequiredHeader, parsePaymentHeader, paymentMiddleware and setNativeReceipt; normalizePayment, verify and settle wrappers; parseX402Payload and createFacilitatorRoutes handlers/discovery. Existing requirement creation, price parsing, network classification, certificate hash, BCS converters, legacy verification and settlement, HTTP encoding and native converters enter contract-only. No crypto/replay-policy redesign is claimed.

Reuse the fragment above; closest shape 09 for finite configured-key search and discovery folds. `expected` always denotes seller-supplied authoritative terms, never payer accepted. `match` compares scheme, canonical network, exact decimal-string amount, asset, payTo, timeout and extra metadata. Well-formed config contains valid private key/chain entries and finite JSON values; no concurrent mutation. Boundary operations below are spec vocabulary, not runnable JavaScript semantics.

```k
claim <k> createPaymentRequiredHeader(T,C,R) => encodedNativeOffer(T,C,R) ... </k>
  requires validRoute(C) andBool mapped(C.network) [all-path]
claim <k> parsePaymentHeader(H,E) => legacyPayload(decoded(H),E.network) ... </k>
  requires nativeV2(H) andBool authoritative(E) andBool match(decoded(H).accepted,E) [all-path]
claim <k> parsePaymentHeader(H,E) => error ... </k>
  requires nativeV2(H) andBool (absent(E) orBool notBool match(decoded(H).accepted,E)) [all-path]
claim <k> parsePaymentHeader(H,E) => decoded(H) ... </k>
  requires validLegacyHeader(H) [all-path]
claim <k> normalizePayment(P,E,C) => normalized(P,E,C) ... </k>
  requires validExpected(E) andBool validPayload(P)
    andBool (P.version ==Int 1 orBool match(P.accepted,legacyExpected(E))) [all-path]
claim <k> normalizePayment(P,E,C) => error ... </k>
  requires P.version ==Int 2 andBool notBool match(P.accepted,legacyExpected(E)) [all-path]
claim <k> verify(P,E,C) => answerInKind(P,legacyVerify(normalized(P,E,C),C)) ... </k>
  requires validExpected(E) andBool validPayload(P) andBool matchIfNative(P,E) [all-path]
claim <k> settle(P,E,C) => answerInKind(P,legacySettle(normalized(P,E,C),C)) ... </k>
  requires validExpected(E) andBool validPayload(P) andBool matchIfNative(P,E) [all-path]
claim <k> verify(P,E,C) => mismatchVerdict ... </k> <effects> 0 => 0 </effects>
  requires P.version ==Int 2 andBool notBool matchIfNative(P,E) [all-path]
claim <k> settle(P,E,C) => mismatchVerdict ... </k> <effects> 0 => 0 </effects>
  requires P.version ==Int 2 andBool notBool matchIfNative(P,E) [all-path]
claim <k> parseX402Payload(J) => jsonValue(J) ... </k>
  requires validJsonText(J)
  ensures decimalStringsUnchanged(J) [all-path]
claim <k> setNativeReceipt(S) => .K ... </k>
  requires validLegacyReceipt(S)
  ensures nativeReceiptEmittedIfMapped(S) andBool legacyHeaderUnchanged [all-path]
claim <k> paymentMiddleware(Q,C) => outcome(Q,C) ... </k>
  requires validMiddlewareConfig(C)
  ensures nativeHeaderPriority(Q) andBool mismatchBeforeFacilitator(Q)
    andBool fastSuccessHasZeroSettlementCalls(Q)
    andBool mappedSuccessHasBothReceipts(Q)
    andBool unmappedLegacySuccessPreserved(Q) [all-path]
claim <k> createFacilitatorRoutes(C) => routes(C) ... </k>
  requires validConfig(C)
  ensures httpDecodePreservesDecimalStrings andBool legacyKindsRetained
    andBool nativeKindsEqualMappedLegacyKinds
    andBool signersEqualConfiguredEvmAccount(C) [all-path]
```

`answerInKind` leaves legacy verdicts unchanged and canonicalizes native result networks; native settlement exposes transaction via the shared converter. The middleware's absent-header outcome adds native advertising only for mapped routes and leaves legacy body identical. Present malformed/wrong-version native headers return 402 before facilitator calls, even with a valid legacy header. An empty native header also returns 402 without fallback. Fast successful verification returns next before the EVM settlement statement; direct facilitator Fast settlement calls the unchanged verify/hash-only path, not a submit path.

Final reviewed revision adds the Release 1 supported-flow side condition: every native Fast expected requirement and native Fast accepted offer must declare `extra.paymentFlow == "upfront"`. `validExpected`, `validPayload`, and `matchIfNative` above include this condition. Unsupported native flow (`deferred`, `authorization`, missing) → normalizer error → mismatch verdict with zero provider effects, even if the certificate is otherwise valid and seller/payer agree on the unsupported flow. Legacy Fast expected/payload pairs keep their prior behavior. This condition is a wire-domain guard, not a replay/trust-policy change.

Finite loops/callback scans instantiate this circularity for configured alias selection, EVM/Fast discovery enumeration and mapped-kind filtering:

```k
claim <k> scan(A,I,S) => foldRemaining(A,I,S) ... </k>
  requires 0 <=Int I andBool I <=Int size(A)
    andBool correctPrefix(A,I,S) [all-path]
```

Each body performs a lookup/guard step, appends precisely its eligible item or skips it, then increments I; guarded circularity applies to the suffix. Empty suffix returns S; search returns its first matching configured key. No counter-bounding condition beyond finite indexed-prefix bounds, no numeric accumulation. Contract-only route/config selectors and converters frame untouched terms and the payload body.

[ESCALATION BOUNDARY] Complete TypeScript/Express/HTTP and asynchronous semantics, object aliasing and structural metadata equality require semantics beyond this fragment. Existing provider/signature/certificate correctness and replay behavior are boundary contracts, not proved properties. Account-address derivation and actual chain actions remain library/provider obligations. Trusted base: fragment adequacy, reachability metatheory, elementary first-order/map reasoning; no solver or K toolchain run.

## Final whole-branch composition — 2026-10-08

Status: constructed (escalation-bounded), not machine-checked; partial correctness. The final/deep-mode review composes the approved client/types and server/facilitator slice claims by Transitivity and adds live-harness contracts and finite completion circularities. Full claims, semantics obligations, guardedness and VC disposition are in PROOF.md. Scope is all current tracked/untracked Release 1 changes against main `cf40d97ac6a960497e62715bfa692e30e3f7c94c`; CLI command production body remains unchanged against that base. Existing crypto/replay/provider internals remain contract-only.

Live boundary preconditions: explicit X402_LIVE_MATRIX=1; complete syntactically validated external key/config values; separate controlled payer/recipient/facilitator wallets; pinned Fast testnet endpoint and independently trusted committee keys; Base chain ID 84532 and six-decimal token assertions before payment; bounded separately funded gas wallet, no refills during the authorized run. Ordinary test configuration excludes both live files and no dotenv load occurs. Fixed run registers eight sequential cases, each containing one pay invocation, zero harness retries and no bridge config. Only independently confirmed hash/receipt and exact 1000-unit recipient increment can increment completion; missing opt-in or fewer than eight completions fails the explicit release gate. RPC authenticity and live chain outcomes are open external obligations, not discharged by offline tests.

Runnable K emission is explicitly escalation-bounded: faithful TypeScript/Express/Fetch/async/Vitest/provider semantics exceed the reused mini-imperative fragment. No invented runnable .k artifacts, toolchain commands or #Top are claimed. No test deletion is authorized or recommended. The constructed proof does not certify publishing readiness while historical live matrix and complete versioned downstream gates remain pending.
