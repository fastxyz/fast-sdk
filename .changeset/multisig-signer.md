---
'@fastxyz/sdk': minor
'@fastxyz/cli': minor
---

Add multisig support across the SDK and CLI.

**SDK:** New `MultiSigSigner` class plus helpers `deriveMultiSigAddress`,
`deriveMultiSigAddressBytes`, `assertAuthorizedSigner`. The signer
produces a single partial signature wrapped in the on-wire `MultiSig`
envelope; the proxy aggregates partials across cosigners. Tagged
errors: `MultiSigConfigInvalidError`, `NotAuthorizedSignerError`.
Signer addresses are canonicalized and validated in the same raw-byte order
as the Rust implementation. Signers defensively copy key/config inputs and
refuse envelopes whose sender is not the derived multisig address.

**CLI:** New `fast multisig` command group (`init`, `import`, `export`,
`pending`, `vote`). The `accounts` table is migrated to a tagged union
(`single` | `multisig`). `fast send` is polymorphic on account kind for
the Fast→Fast route. New `fast token create`, `fast token mint`,
`fast token burn`, and `fast token manage` commands share the same
single-signer/multisig submission pipeline. `fast account list` shows a
`KIND` column.
Rust `wallet.json` files can be imported. Pending transactions are restricted
to the account's current nonce and rendered in full before voting; retrying an
already-recorded partial is supported. Token management/mint commands perform
local authority checks, unknown submit results fail closed, and Fast transfers
accept a 32-byte `--memo`.
