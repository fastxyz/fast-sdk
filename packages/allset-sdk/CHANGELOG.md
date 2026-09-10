# @fastxyz/allset-sdk

## 1.1.0

### Minor Changes

- 58f0f9f: Add Arc mainnet (chain 5042) to `CHAIN_MAP` via a `defineChain` export `arc`, so `createEvmExecutor(account, rpcUrl, 5042)` resolves without a caller-supplied Chain object.

  On chains whose gas token is the deposited ERC-20 (Arc: USDC, declared via `chain.custom.gasTokenErc20`), `executeDeposit` now requires `balance >= amount + fee reserve` for the approve + deposit pair and throws `InsufficientBalanceError` otherwise, instead of letting the approve consume the gas and the deposit revert. New helpers: `gasTokenErc20`, `estimateGasReserve`, `estimateGasReserveAt`, `weiToTokenUnits`, `DEPOSIT_GAS_UNITS`.

## 1.0.6

### Patch Changes

- Updated dependencies [37e62af]
  - @fastxyz/sdk@2.3.1

## 1.0.5

### Patch Changes

- Updated dependencies [7aad16b]
- Updated dependencies [8ecfb10]
  - @fastxyz/sdk@2.3.0

## 1.0.4

### Patch Changes

- Updated dependencies [00635d3]
  - @fastxyz/sdk@2.2.0

## 1.0.3

### Patch Changes

- Updated dependencies [f4ce27c]
- Updated dependencies [c01ec1e]
  - @fastxyz/sdk@2.1.0

## 1.0.2

### Patch Changes

- 6b184ec: Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
  Fixed x402 serialization format handling for Effect Schema decoded transactions.
  Updated x402-facilitator with version-agnostic BCS handling and format variant support.
  Internal dependency updates for allset-sdk.
- Updated dependencies [6b184ec]
  - @fastxyz/schema@2.0.0
  - @fastxyz/sdk@2.0.0
