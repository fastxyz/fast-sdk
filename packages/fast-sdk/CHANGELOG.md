# @fastxyz/sdk

## 2.1.0

### Minor Changes

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

### Patch Changes

- c01ec1e: Update `mainnet.defaultToken` to fastUSD (`0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb`, symbol `fastUSD`, 6 decimals). `testnet.defaultToken` is unchanged.

## 2.0.0

### Major Changes

- 6b184ec: Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
  Fixed x402 serialization format handling for Effect Schema decoded transactions.
  Updated x402-facilitator with version-agnostic BCS handling and format variant support.
  Internal dependency updates for allset-sdk.

### Patch Changes

- Updated dependencies [6b184ec]
  - @fastxyz/schema@2.0.0
