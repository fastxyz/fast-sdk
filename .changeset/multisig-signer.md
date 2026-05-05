---
"@fastxyz/sdk": minor
"@fastxyz/cli": minor
---

Add multisig support across the SDK and CLI.

**SDK:** New `MultiSigSigner` class plus helpers `deriveMultiSigAddress`,
`deriveMultiSigAddressBytes`, `assertAuthorizedSigner`. The signer
produces a single partial signature wrapped in the on-wire `MultiSig`
envelope; the proxy aggregates partials across cosigners. Tagged
errors: `MultiSigConfigInvalidError`, `NotAuthorizedSignerError`.

**CLI:** New `fast multisig` command group (`init`, `import`, `export`,
`pending`, `vote`). The `accounts` table is migrated to a tagged union
(`single` | `multisig`). `fast send` is polymorphic on account kind for
the Fast→Fast route. `fast account list` shows a `KIND` column.
