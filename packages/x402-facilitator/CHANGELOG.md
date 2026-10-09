# @fastxyz/x402-facilitator

## 1.1.0

### Minor Changes

- 8dc921a: Add x402 v2 wire compatibility while preserving the existing v1-shaped APIs.
  Clients answer in the version advertised by the seller; v1-only sellers continue
  to receive X-PAYMENT. Dual-version servers and facilitators accept either form.
  The CLI inherits v2 dry-run and payment support without command-code changes.

  The four x402 packages target 1.1.0. Publishing remains gated on the approved
  live FAST/Base mainnet version matrix and drop-in consumer checks; this changeset alone
  does not establish those gates or authorize publication.

### Patch Changes

- Updated dependencies [8dc921a]
  - @fastxyz/x402-types@1.1.0

## 1.0.8

### Patch Changes

- Updated dependencies [0333729]
- Updated dependencies [f95e12a]
  - @fastxyz/sdk@2.4.0

## 1.0.7

### Patch Changes

- Updated dependencies [37e62af]
  - @fastxyz/sdk@2.3.1

## 1.0.6

### Patch Changes

- Updated dependencies [7aad16b]
- Updated dependencies [8ecfb10]
  - @fastxyz/sdk@2.3.0

## 1.0.5

### Patch Changes

- Updated dependencies [00635d3]
  - @fastxyz/sdk@2.2.0

## 1.0.4

### Patch Changes

- f4ce27c: Add built-in Fast network constants to `@fastxyz/sdk`.

  ### `@fastxyz/sdk`

  **New exports from `@fastxyz/sdk`:**
  - `FastNetwork` — interface for defining a custom network (analogous to viem's `Chain`)

  **New exports from `@fastxyz/sdk/networks`:**
  - `mainnet` — built-in `FastNetwork` for the Fast mainnet (`fast:mainnet`), includes `defaultToken` (USDC)
  - `testnet` — built-in `FastNetwork` for the Fast testnet (`fast:testnet`), includes `defaultToken` (testUSDC)
  - `FastToken` — interface for token metadata `{ tokenId, symbol, decimals }`

  `ProviderOptions` gains optional `networkId` and `explorerUrl` fields. The built-in constants satisfy `ProviderOptions` directly.

  **Before (v2.0):**

  ```ts
  const provider = new FastProvider({ url: 'https://api.fast.xyz/proxy-rest' });
  ```

  **After (v2.1):**

  ```ts
  import { FastProvider } from '@fastxyz/sdk';
  import { mainnet, testnet } from '@fastxyz/sdk/networks';

  const provider = new FastProvider(mainnet); // built-in mainnet
  const provider = new FastProvider(testnet); // built-in testnet
  const provider = new FastProvider({
    // custom / explicit
    url: 'https://api.fast.xyz/proxy-rest',
    networkId: 'fast:mainnet',
  });
  ```

  ### `@fastxyz/x402-client`
  - `BridgeConfig.networkId` and `getFastBalance` options now use the `NetworkId` literal type (`'fast:localnet' | 'fast:devnet' | 'fast:testnet' | 'fast:mainnet'`) instead of `string`.

  ### `@fastxyz/x402-facilitator`
  - `getExpectedFastNetworkId` return type narrowed from `string | null` to `NetworkId | null`.

  ### `@fastxyz/cli`
  - Built-in `mainnet` / `testnet` network definitions now sourced directly from `@fastxyz/sdk/networks`.
  - App name and version now read from `package.json` (no separate `config/app.json`).

- Updated dependencies [f4ce27c]
- Updated dependencies [c01ec1e]
  - @fastxyz/sdk@2.1.0

## 1.0.3

### Patch Changes

- 6b184ec: Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
  Fixed x402 serialization format handling for Effect Schema decoded transactions.
  Updated x402-facilitator with version-agnostic BCS handling and format variant support.
  Internal dependency updates for allset-sdk.
- Updated dependencies [6b184ec]
  - @fastxyz/schema@2.0.0
  - @fastxyz/sdk@2.0.0

## 1.0.2

### Patch Changes

- 614b96c: Fix serialization format handling for Effect Schema decoded transactions
  - **x402-client**: Replace manual `toBcsFormat()` with `Schema.encodeSync(VersionedTransactionFromBcs)` for correct BCS hash computation. Adds `effect` as a direct dependency.
  - **x402-facilitator**: Fix `toBcsFormat()` to convert decimal string bigints from JSON roundtrip. Fix `extractSenderSignature()` and `hasMultiSig()` to handle typed variant format (`{type, value}`) in addition to keyed variant format.
