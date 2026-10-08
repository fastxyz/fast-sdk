# Exact Fast payments for x402 v2

Status: migration design; not a claim that a v2 package is published or deployed.

Target: protocol version 2 using the published `@x402/*` 2.28.0 interfaces. Runtime dependencies must remain on the approved 2.28 patch line and be frozen in the lockfile; an upstream `main` change is not automatically part of this contract.

## Scheme and network identifiers

The scheme is `exact`. The mechanism handles only the explicit network identifiers `fast:mainnet` and `fast:testnet`. The identifier in the signed Fast transaction must match the selected requirement and the locally configured provider and committee. Structural CAIP-2 syntax is not proof of a namespace registration or a network's identity.

The application-specific `fast` namespace is already used in Fast transaction domains. Submission of an upstream mechanism or ecosystem listing must disclose its registration status; this document does not assert approval by ChainAgnostic.

Legacy x402 aliases `fast-mainnet` and `fast-testnet` are translated only at a version-1 compatibility boundary. Do not normalize an unknown identifier, the ambiguous `fast` identifier, or an unconfigured `fast:*` reference to mainnet. EVM networks belong to `@x402/evm`, using explicit `eip155:<chain-id>` identifiers.

## Payment requirement

A version-2 `PaymentRequired` contains its resource once, at top level. Each accepted requirement contains:

- `scheme: "exact"`;
- an explicitly configured Fast network;
- `asset`: the full 32-byte Fast token identifier, in the documented canonical hex representation;
- `amount`: a positive decimal atomic-unit integer, with no floating-point conversion;
- `payTo`: a validated Fast recipient address;
- a valid `maxTimeoutSeconds`;
- `extra.paymentFlow: "upfront"`.

Amounts, assets, destinations, and network identity are authoritative server requirements, not values taken from an untrusted client's `accepted` echo. The server must match the selected offer against its own requirements before a paid handler runs. A missing or conflicting resource, asset, network, amount, or destination must not cause fallback to another payment.

Illustrative v2 offer (replace the placeholder recipient before use):

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://merchant.example/orders",
    "description": "One authorized purchase",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "fast:testnet",
      "asset": "0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46",
      "amount": "1000",
      "payTo": "<validated Fast recipient>",
      "maxTimeoutSeconds": 60,
      "extra": { "paymentFlow": "upfront" }
    }
  ]
}
```

The server scheme declares:

```ts
readonly scheme = 'exact';
readonly defaultAssetTransferMethod = 'default';
readonly paymentFlows = {
  default: { supported: ['upfront'], default: 'upfront' },
} as const;
```

`default` is SDK plumbing, not a newly invented on-wire asset-transfer method. The mechanism must reject an unsupported flow rather than advertise authorization semantics for an already-paid certificate.

## Payment payload

The client builds a canonical, single-transfer Fast transaction for the selected network, token, exact amount, and recipient. It submits that authorized transfer and obtains its transaction certificate before issuing the paid HTTP request. The mechanism returns the scheme payload to core; core constructs the v2 envelope and accepted requirement:

```ts
{
  x402Version: 2,
  accepted: serverRequirement,
  payload: {
    type: 'signAndSendTransaction',
    transactionCertificate: certificate,
  },
  resource: resourceInfo,
}
```

The transfer's sender comes from the signed transaction. A separate, unverified payer field is not proof of payment. Decimal bigints and byte arrays need a lossless, bounded JSON wire representation; generic `JSON.stringify` of in-memory Fast SDK objects is insufficient. Do not accept lossy JSON-number conversions for nonces or amounts.

The certificate is a bearer payment proof and potentially sensitive. Treat its encoded header and decoded representation as sensitive in logs, analytics, exceptions, model context, and browser telemetry. HTTP headers are case-insensitive for decoding and redaction.

## Verification and trust

The mechanism verifies the certificate against the **server's** requirement:

1. Reject malformed, oversized, unsupported-version, or unsupported-operation certificates.
2. Reconstruct the canonical signed transaction and domain using the Fast schema for its version.
3. Validate the sender signature over that domain, the explicit signed network, and the supported single-transfer operation.
4. Validate distinct validator signatures against a locally trusted committee and its quorum threshold. The payload cannot nominate its own trusted signers. An empty committee is not an implicit trust mode.
5. Match the transfer's recipient, token identifier, and exact atomic amount to the requirement. Do not silently accept overpayment for the v2 `exact` mechanism.
6. Apply documented freshness and purchase-binding policy. `maxTimeoutSeconds` alone does not bind a previously signed transfer to a particular resource or order. Unsigned `resource` or `accepted` fields do not provide that binding.
7. Where deployment policy requires proxy read-back, reconcile the exact signed transaction, sender, and nonce; an unavailable proxy is unknown, not proof of nonpayment or permission to accept an untrusted committee.

The existing v1 verifier's compatibility behavior must remain separately tested. It must not silently weaken v2's trust policy through an internal conversion to v1.

## Settlement, replay, and fulfillment

Fast settlement is already complete before the merchant receives the certificate. The facilitator must never rebuild or submit another transfer to “settle” that certificate.

In `@x402/core` 2.28.0, upfront sets `verifyBeforeHandler: false`, `settleBeforeHandler: true`, and `settleAfterHandler: false`. Therefore `settle()` must independently run full certificate and requirement verification. A caller need not have called `verify()` first.

A successful cryptographic check is not an order-replay defense. The deployed seller/facilitator combination must enforce a durable certificate-to-purchase binding:

- Key by canonical network and signed transaction hash, not base64 header text, version, validator-signature ordering, or caller-generated aliases.
- Keep v1 and v2 representations in the same replay namespace.
- Perform atomic claim/lookup across replicas and restarts. Process-local sets, check-then-write maps, and the upstream pending store's separate `get`/`set` methods are not sufficient.
- Bind the claim to authoritative merchant, purchase, payer, and fulfillment context. Reusing the same certificate for a different purchase must fail closed.
- A retry for the same purchase must recover the original result without creating another order or payment. Losing the response does not free the certificate.
- Storage failure or uncertainty must preserve the pending/unknown state and prevent new fulfillment. Do not treat `unknown` as available.

The exact division between the package's settlement evidence and each merchant's existing durable order/replay ledger must be established before implementing or enabling v2. This draft intentionally does not fabricate a persistence adapter or claim exactly-once application behavior from a stateless mechanism.

On success, return the canonical Fast transaction hash in upstream `SettleResponse.transaction`, the configured network, and the verified payer. Keep compatibility aliases such as `txHash` at the wrapper boundary. Do not return successful settlement with an empty hash.

`settlement_pending` is nonterminal. The pinned core may retry settlement once immediately when `transaction` is present. Handle that retry with the identical payload, requirement, and durable replay state. Do not create a fresh transaction or claim a different purchase. A pending receipt is not permission to fulfill twice.

Upfront payment is not conditional on successful application execution. Handler errors can leave paid-but-unfulfilled purchases requiring recovery or refund; the package must expose the receipt and uncertainty to the application, not promise an automatic refund.

## Client authorization, spend policy, and recovery

Select an authorized network, asset, recipient, and per-payment atomic cap before creating a payment payload. Enforce the cap before signing, submission, or an AllSet bridge hook. A quote is not an enduring authorization to pay a later increased price.

The 2.28.0 client's default policy allows only recognized default assets, with a default USD cap of $1. Do not disable controls globally to make Fast Shop orders work. Applications must configure quote-bound caps explicitly, and unrecognized assets need explicit allowlisting and atomic caps.

The current core Fast SDK's default mainnet asset is **fastUSD**, not USDC; testnet defaults to **testUSDC**. Do not infer that every Fast token is dollar-pegged from its symbol or from the plan's generic “Fast USDC” wording. The mechanism's default-asset registry must use reviewed network/token/decimals mappings. Other assets remain explicitly opt-in; an unknown token must not acquire USD pricing by falling back to six decimals.

Persist the authorized attempt, exact signed envelope, transaction identity, and eventual certificate using an application-owned durable recovery path. An uncertain submission or HTTP failure must not automatically run payload creation again. In particular, do not return `{ recovered: true }` from a generic fetch recovery hook if it would cause a second upfront transfer. Recovery retries the same paid request only after reconciling the original payment.

AllSet is an explicitly authorized pre-payment funding step, not part of the certificate's settlement. It needs its own network/asset bindings, cap, journal, and destination reconciliation. Unknown bridge delivery must not trigger another bridge or payment.

## HTTP and v1 compatibility

| Direction | Version 2 | Version 1 compatibility |
| --- | --- | --- |
| Payment-required response | Base64 `PaymentRequired` in `PAYMENT-REQUIRED` | v1 JSON body with `maxAmountRequired` and legacy network aliases |
| Client payment | `PAYMENT-SIGNATURE`, with `accepted` | `X-PAYMENT`, with root scheme/network |
| Settlement response | `PAYMENT-RESPONSE` | `X-PAYMENT-RESPONSE` |

Sellers accept both versions during migration. They cannot emit a v2 body with legacy fields and call it v1 compatibility. Both settlement-response headers must describe the same result in their respective shapes. Requests with conflicting payment headers must be rejected; header presence or parse failure must never cause a new payment attempt.

Preserve `x402Pay`, `parse402Response`, `handleFastPayment`, and the in-process `verify()` entry point through explicit version adapters. Re-export upstream types with explicit v1/v2 names during the transition; the old `PaymentRequirement` shape is not an alias for upstream v2 `PaymentRequirements`.

Core exposes `registerV1` on client and facilitator, but not resource server. Configure resource-server registration and supported kinds deliberately instead of assuming a nonexistent server API.

The facilitator's `/supported` reports actual configured versions, networks, schemes, extensions, and signer identities. Do not advertise a settlement-signing key when a certificate-only Fast facilitator does not have one. Advertised v2 support is not evidence of a seller's deployed upgrade.

## Release and validation gates

- New mechanism: `@fastxyz/x402-fast` 1.0.
- Wrapper majors: client, server, and facilitator 2.0, with compatibility entry points.
- Types package: documented migration to upstream types, preserving deliberate legacy names during the transition before deprecation.
- Release candidates under `next`; retain the 1.x line for rollback and fixes. npm dist-tag changes are release actions, not side effects of installing dependencies.

Gate 1 requires the four client/server version combinations on Fast testnet and Base/Arbitrum Sepolia, unmodified Foundation fetch-client interop with the registered Fast mechanism, and a third-party v2 EVM seller. Security tests must additionally cover direct settle without verify, wrong committee/network/asset/recipient/amount, malformed headers, concurrent replay across replicas, crash/restart recovery, lost-ACK recovery, pending receipt retry, price increases, and redaction.

Gate 2 requires dual-version sellers, one operator-approved canary purchase per version, seven days without stranded payments, and deployed-build evidence. No first-party buyer switches to v2 before every seller it calls is verified dual-version. Version retirement waits 90 days without first-party v1 traffic and an explicit third-party compatibility decision.

## Evidence

Checked 2026-10-07 against the published `@x402/core` 2.28.0 artifact and Fast SDK `main` at `cf40d97ac6a960497e62715bfa692e30e3f7c94c`.

- [Published core artifact](https://registry.npmjs.org/@x402/core/-/core-2.28.0.tgz): mechanism types, flow flags, spend controls, compatibility registration, and pending retry behavior.
- [Foundation protocol v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) and [HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md): current source entry points; confirm changes against the pinned SDK before adopting them.
- [Existing Fast payment handler](https://github.com/fastxyz/fast-sdk/blob/cf40d97ac6a960497e62715bfa692e30e3f7c94c/packages/x402-client/src/fast.ts): sends a transfer before the paid HTTP request.
- [Existing certificate verifier](https://github.com/fastxyz/fast-sdk/blob/cf40d97ac6a960497e62715bfa692e30e3f7c94c/packages/x402-facilitator/src/verify.ts) and [settlement handler](https://github.com/fastxyz/fast-sdk/blob/cf40d97ac6a960497e62715bfa692e30e3f7c94c/packages/x402-facilitator/src/settle.ts): starting points, not a complete v2 replay contract.
