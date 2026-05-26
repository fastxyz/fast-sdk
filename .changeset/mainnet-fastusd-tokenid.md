---
"@fastxyz/sdk": patch
"@fastxyz/cli": patch
---

Update the bundled mainnet `defaultToken` tokenId. The symbol remains
`fastUSD`, but its `tokenId` changes from
`0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb` to
`0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130`.

**Behavior change**: CLI commands that resolve the network's default
token without an explicit `--token` flag (e.g. `fast send`, `fast info
balance`) and any `--token fastUSD` invocations on mainnet now operate
against the new tokenId. The dedicated `fast fund fastusd` command is
unaffected. Testnet default (`testUSDC`) is unchanged.
