# Task — bounded exact Fast server mechanism

Status: constructed (escalation-bounded), not machine-checked.
Scope: uncommitted `packages/x402-fast` and `pnpm-lock.yaml` against cf40d97. This is a per-task review, not the migration or untracked docs/x402 drafts. Intent: the assigned bounded server-only requirements and package README/tests. No earlier feature verification fragment existed.

## Vocabulary and semantics fragment

Let M = 2^256-1; N = {fast:mainnet, fast:testnet}; asset(A) mean A matches lowercase `0x` plus exactly 64 hexadecimal digits; atomic(A) mean A is the canonical decimal spelling of an integer in [1,M]. money(T) means optional `$`, a canonical nonnegative integer part, optional 1–6-digit fraction, with resulting atomic amount in [1,M]. If integer part is W, fraction digits denote F and have length D, conversion is W*10^6 + F*10^(6-D). Missing fraction has F=0,D=0.

The mini-TS fragment uses `<k>` computation, `<store>` locals and `<heap>` objects. Sequential calls preserve continuations; exact BigInt arithmetic maps to mathematical Int, branch guards case-split, spreads allocate fresh outer objects, Object.freeze prevents writes to the explicitly frozen objects. String conversion of numbers uses JavaScript's shortest round-trip decimal text, not the original source literal. No loops or recursion occur in changed production code; no circularities are required. Shape 02 function contracts is adapted to straight-line calls. The actual TypeScript/string/object semantics remain an explicit escalation boundary, not a runnable invented K language.

## Function contracts

Below are schematic reachability claims in K notation, not executable K artifacts. `ok`, `moneyResult`, `decimalsResult`, and `enhanced` are spec-only result constructors/predicates. Functions are the loaded reviewed bodies. Rejection contracts are documented separately because the in-domain fragment does not model exceptions.

```k
claim <k> assertFastNetwork(N:String) => ok ... </k>
  requires N ==String "fast:mainnet" orBool N ==String "fast:testnet" [all-path]
claim <k> validateAsset(A:String) => ok ... </k>
  requires canonicalAsset(A) [all-path]
claim <k> validateAmount(A:String) => ok ... </k>
  requires canonicalAtomic(A) [all-path]
claim <k> parsePrice(P, N:String) => moneyResult(P,N) ... </k>
  requires supportedNetwork(N) andBool validPrice(P) [all-path]
claim <k> getAssetDecimals(A:String,N:String) => decimalsResult(A,N) ... </k>
  requires supportedNetwork(N) [all-path]
claim <k> enhancePaymentRequirements(R,K,E) => enhanced(R) ... </k>
  requires validRequirements(R) andBool matchingCapability(R,K) [all-path]
```

- assertFastNetwork returns only for N; all other strings throw before asset lookup.
- validateAsset returns iff canonicalAsset holds; no normalization is permitted.
- validateAmount returns iff canonicalAtomic holds. The 78-digit bound is sufficient because M has 78 digits; BigInt comparison excludes the remaining overflow spellings.
- parsePrice explicit-asset branch returns the same asset and amount, with a fresh outer extra object when supplied. Money branch returns the network default asset and the exact canonical atomic spelling. Money text of length >80, zero, noncanonical grammar, >6 fraction digits, or overflowing amount rejects. Number inputs additionally require finite and absolute value <= MAX_SAFE_INTEGER; exactness is relative to String(number), not recovery of precision already lost before the call.
- getAssetDecimals returns 6 iff asset equals that network's default, otherwise undefined; unsupported network rejects.
- enhancePaymentRequirements requires core-typed requirements with a present extra object, valid asset/amount, supported network, exact scheme on requirements/capability, matching network and version 2. Flow is absent/upfront; transfer method is absent/default. It returns fresh outer requirements and extra, preserving other fields and setting paymentFlow to upfront. Unsupported guards throw. Facilitator extras/extensions are not imported. Frame: inputs are not mutated; nested custom extras can remain aliased, with no deep-copy guarantee.
- Constants: network array, outer mapping, both asset entries and all nested paymentFlows objects are frozen. No claim that TypeScript readonly alone freezes the scheme instance's property bindings.

## Constructed obligations

VC-DECIMAL: concatenating W with a six-place padded fraction denotes W*10^6 + F*10^(6-D). This follows from positional decimal notation; no floating multiplication occurs. VC-RANGE: validateAmount enforces 1 <= amount <= M after conversion. VC-LENGTH: maximum valid priced amount needs at most 72 integer digits plus dot, six fractional digits and optional dollar =80 characters, so length guard does not exclude a valid upper boundary. VC-MATCH: enhancement's conjunction enforces exact/network/version equality. VC-FRAME: spreads and absence of assignment to input preserve top-level inputs. These are constructed partial-correctness arguments, not machine proofs.

[ESCALATION BOUNDARY] Universal adequacy of JavaScript regex, shortest-number serialization, asynchronous exceptions, heap allocation/spread/freezing and imported core behavior is not discharged by the mini-imperative fragment. Tests and direct probes provide evidence, not universal proofs. Trusted base: reachability metatheory, elementary integer/decimal lemmas and the stated semantics model; no SMT or kprove execution is claimed.

## Task 2 — authoritative response parser and execution guard, 2026-10-08

Status: constructed (escalation-bounded), not machine-checked. Per-task diff against f687ff9: x402-client index/types, CLI pay amount branch, response.test.ts and pay-dry-run-v2.test.ts. Root docs/x402 drafts and other migration units are excluded. Intent is the approved task contract: authoritative native v2 header through pinned core 2.28.0 decode/schema; canonical standard base64 bounded to 65536 encoded characters; no fallback/body consumption on present header; sanitized errors; absent-header legacy JSON; early execution-version rejection; correct v1/v2 display and native JSON.

Reuse the Task 1 mini-TS sequential/branch fragment, extended with response body-consumption state B and sensitive-call trace T. A get-header primitive is case-insensitive and returns null iff absent; Fetch Headers may normalize leading/trailing whitespace before this observable boundary. Await sequences a fulfilled result or propagates rejection. Try/catch replaces decoder/schema failures with a fixed error. No changed production loop/recursion needs a new circularity: the CLI's existing finite offer loop retains its structure, and the new expression is analyzed per offer.

The following are schematic K-notation contracts, not runnable semantics. HeaderValid(H) means 0<length(H)<=65536, canonical standard-base64 round trip, core decoder success and PaymentRequiredV2Schema acceptance. LegacyJSON(R) is the prior response.json result, including its prior rejection behavior. loaded bodies and library primitives are contract-only where unchanged/imported.

```k
claim <k> parse402Response(R) => decoded(H) ... </k>
  <store> bodyUsed |-> B ... </store>
  requires status(R) ==Int 402 andBool header(R) ==K H
    andBool HeaderValid(H) [all-path]
claim <k> parse402Response(R) => LegacyJSON(R) ... </k>
  requires status(R) ==Int 402 andBool header(R) ==K absent [all-path]
claim <k> x402Pay(P) => reject("v2 payment execution not enabled") ... </k>
  <store> sensitiveTrace |-> T ... </store>
  requires initial402(P) andBool parsedVersion(P) ==Int 2 [all-path]
claim <k> x402Pay(P) => reject("Unsupported x402 protocol version") ... </k>
  <store> sensitiveTrace |-> T ... </store>
  requires initial402(P) andBool explicitVersion(P)
    andBool parsedVersion(P) =/=K 1 andBool parsedVersion(P) =/=K 2 [all-path]
claim <k> displayAmount(V,O) => amountForVersion(V,O) ... </k>
  requires V ==Int 1 orBool V ==Int 2 [all-path]
```

Rejection contracts additionally require non-402 to fail before decode/body, and present invalid H to reject with exactly Invalid PAYMENT-REQUIRED header, unchanged B and no legacy JSON call. Undefined/1 legacy versions retain prior execution dispatch; legacy malformed-body shape remains intentionally unvalidated. Sensitive trace covers requirement-details serialization, handlers, signing/bridging/payment and retry, not initial request or wallet classification. Export contract: PaymentRequiredV2 aliases upstream PaymentRequired and ParsedPaymentRequired unions it with the existing legacy shape; index export-star exposes both. Display postcondition is O.maxAmountRequired for V=1 and O.amount for V=2; JSON retains the parsed object.

Constructed VCs: VC-AUTH splits null versus non-null with no edge from the latter to body JSON; VC-BOUND rejects before regex/Buffer for H>65536, bounds decoded bytes by 3*65536/4=49152; VC-CANON uses syntax plus decode/re-encode equality to exclude missing padding, alternate alphabet/junk and nonzero pad bits; VC-ERROR both lexical and caught decode/schema paths use a constant message without causes; VC-VERSION strict equality/inequality rejects all explicit non-1 values before details and handlers; VC-DISPLAY is false for a valid legacy JSON offer with an extra amount field (see FINDINGS). No payment-mechanism enablement is introduced.

[ESCALATION BOUNDARY] Universal Node Buffer/base64, Fetch Headers, UTF-8/JSON, Zod schema and async-effect semantics exceed the integer fragment. Core schema validation is structural, not amount/network/recipient execution authorization; notably core accepts any nonempty amount and a network string containing a colon. Returning decoded rather than schema-normalized data deliberately retains native JSON and unknown properties. Trusted base: stated primitive contracts, reachability metatheory and elementary length/branch reasoning; no SMT/kprove/#Top run. Claims establish constructed partial correctness only, not external I/O termination.

Task 2 repair re-review: VC-DISPLAY now discharges by case analysis on the enclosing paymentRequired.x402Version===2, rather than field presence. V=2 returns O.amount; all legacy versions return O.maxAmountRequired. Extra conflicting fields cannot alter this choice. The previously failed VC above is retained as historical evidence, not an outstanding obligation.
