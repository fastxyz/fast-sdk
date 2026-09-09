---
"@fastxyz/cli": minor
---

Bundle Arc mainnet (`arc`, chain 5042) in the mainnet network: AllSet bridge `0x8677EdAA...`, USDC `0x3600...0000` -> fastUSD.

Route every bundled `evmRpcUrl` (testnet and mainnet) through the AllSet Portal's RPC proxy (`{portal}/chain/rpc/<chain>`) instead of embedding a dRPC key in the package. The previously embedded key is deactivated, so bundled EVM calls were failing; the proxy needs no key.
