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
