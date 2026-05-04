---
"@fastxyz/sdk": minor
---

Add `MultiSigSigner` and helpers (`deriveMultiSigAddress`,
`deriveMultiSigAddressBytes`, `assertAuthorizedSigner`) for N-of-M
multisig wallets. The signer produces a single partial signature
wrapped in the on-wire `MultiSig` envelope; the proxy aggregates
partials across cosigners. Tagged errors: `MultiSigConfigInvalidError`,
`NotAuthorizedSignerError`.
