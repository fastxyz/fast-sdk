---
"@fastxyz/sdk": patch
"@fastxyz/cli": patch
---

Change the bundled mainnet `defaultToken` from `fastUSD` to `USDC`
(tokenId `0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130`).

**Behavior change**: any CLI command that resolves the network's default
token without an explicit `--token` flag (e.g. `fast send`, `fast info
balance`) now defaults to `USDC` on mainnet. Pre-existing scripts that
relied on the implicit fastUSD default must add `--token fastUSD`
explicitly. The dedicated `fast fund fastusd` command is unaffected.
Testnet default (`testUSDC`) is unchanged.
