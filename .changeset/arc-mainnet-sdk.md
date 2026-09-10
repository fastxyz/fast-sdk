---
"@fastxyz/allset-sdk": minor
---

Add Arc mainnet (chain 5042) to `CHAIN_MAP` via a `defineChain` export `arc`, so `createEvmExecutor(account, rpcUrl, 5042)` resolves without a caller-supplied Chain object.

On chains whose gas token is the deposited ERC-20 (Arc: USDC, declared via `chain.custom.gasTokenErc20`), `executeDeposit` now requires `balance >= amount + fee reserve` for the approve + deposit pair and throws `InsufficientBalanceError` otherwise, instead of letting the approve consume the gas and the deposit revert. New helpers: `gasTokenErc20`, `estimateGasReserve`, `estimateGasReserveAt`, `weiToTokenUnits`, `DEPOSIT_GAS_UNITS`.
