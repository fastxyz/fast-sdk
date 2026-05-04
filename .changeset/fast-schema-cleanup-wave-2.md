---
"@fastxyz/schema": major
---

Restore palette discipline (wave 2 — REST tightening + new TransportPalette).

**Breaking change:** `NonceFromRest` and `QuorumFromRest` no longer accept string-form input. REST is now wire-faithful — primitives accept only what the Fast proxy actually emits.

### Migration

If you decode REST-shaped payloads that have crossed a JSON-string transport boundary (Chrome extension `port.postMessage` after a `JSON.stringify(bigint → String)` step is the canonical case), import the new `*FromTransport` schemas instead:

```diff
- import { TransactionCertificateFromRest } from '@fastxyz/schema';
+ import { TransactionCertificateFromTransport } from '@fastxyz/schema';
```

The encoded shape is identical for byte/hex/decimal fields; `*FromTransport` additionally accepts string-form bigint primitives. Wallet integrations and any other consumer that round-trips REST payloads through `JSON.stringify(bigint → String)` should migrate.

### New exports

- `TransportPalette` (palette object alongside `RestPalette` / `BcsPalette` / `RpcPalette`)
- `TransactionCertificateFromTransport`, `AccountInfoResponseFromTransport`, `TokenInfoResponseFromTransport`
- `*FromTransport` primitives: `Address`, `Amount`, `Balance`, `ClaimData`, `NetworkId`, `Nonce`, `Quorum`, `Signature`, `State`, `StateKey`, `TokenId`, `UserData`
- Strict bigint helpers: `BigIntFromNumberOrSelf`, `UintBigIntFromNumberOrSelf`, `IntBigIntFromNumberOrSelf`, `Uint64FromNumberOrSelf`, `Uint256FromNumberOrSelf`, `Int320FromNumberOrSelf`

### Internal hardening (item #10a)

`HexBigInt`, `HexNumber`, `BigIntFromNumberOrStringOrSelf`, and `HexLowerBigInt` now use `Schema.transformOrFail`. Decode failures surface as recoverable `ParseError` instead of unhandled JS exceptions, fixing latent `Schema.Union` short-circuit bugs.
