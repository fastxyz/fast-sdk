---
"@fastxyz/cli": minor
---

Bundle Arc mainnet (`arc`, chain 5042) in the mainnet network: AllSet bridge `0x8677EdAA...`, USDC `0x3600...0000` -> fastUSD, `gasToken: { symbol: "USDC", erc20Address: "0x3600...0000" }`.

Chain configs accept an optional `gasToken`. When its `erc20Address` is the deposited token, `fund usdc crypto` requires the balance to cover the amount plus a fee reserve for approve + deposit, and reports the reserve; the "you will also need ETH" hint now names the chain's gas token.

Route every bundled `evmRpcUrl` (testnet and mainnet) through the AllSet Portal's RPC proxy (`{portal}/chain/rpc/<chain>`) instead of embedding a dRPC key in the package. The previously embedded key is deactivated, so bundled EVM calls were failing; the proxy needs no key.
