# @fastxyz/x402-client

## 1.0.8

### Patch Changes

- Updated dependencies [58f0f9f]
  - @fastxyz/allset-sdk@1.1.0

## 1.0.7

### Patch Changes

- Updated dependencies [37e62af]
  - @fastxyz/sdk@2.3.1
  - @fastxyz/allset-sdk@1.0.6

## 1.0.6

### Patch Changes

- 7aad16b: CLI: `send` and `fund usdc crypto` now resolve omitted `--token` to `network.defaultToken.symbol` (sourced from the SDK — `fastUSD` on mainnet, `testUSDC` on testnet) instead of silently falling back to the first chain's first token. When the resolved token isn't available on the targeted chain, the CLI errors with the new `CommandUnsupportedForTokenError` (exit code 2, `COMMAND_UNSUPPORTED_FOR_TOKEN`); typos still surface as `TokenNotFoundError`.

  The PR-#87 default-resolution helpers (`pickDefaultTokenName`, `resolveDefaultToken`, `selectSendTokenName`) and the CLI-only `fastTokens` map are removed in favor of the single SDK-driven path. Custom networks added via `fast network add` should now use `defaultToken` in their JSON.

  x402-client: `X402PayResult.payment.amount` for Fast payments now returns the raw integer string (smallest-unit form) instead of a hardcoded-6-decimals humanization. The wire format does not carry decimals; consumers should humanize using their own token-decimals registry. The CLI's `fast pay` command was updated to humanize for display.

  Also removes the broken `"… raw → … USDC"` diagnostic log line in `x402-client/src/fast.ts`.

- Updated dependencies [7aad16b]
- Updated dependencies [8ecfb10]
  - @fastxyz/sdk@2.3.0
  - @fastxyz/allset-sdk@1.0.5

## 1.0.5

### Patch Changes

- Updated dependencies [00635d3]
  - @fastxyz/sdk@2.2.0
  - @fastxyz/allset-sdk@1.0.4

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
  - @fastxyz/allset-sdk@1.0.3

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
  - @fastxyz/allset-sdk@1.0.2

## 1.0.2

### Patch Changes

- 614b96c: Fix serialization format handling for Effect Schema decoded transactions
  - **x402-client**: Replace manual `toBcsFormat()` with `Schema.encodeSync(VersionedTransactionFromBcs)` for correct BCS hash computation. Adds `effect` as a direct dependency.
  - **x402-facilitator**: Fix `toBcsFormat()` to convert decimal string bigints from JSON roundtrip. Fix `extractSenderSignature()` and `hasMultiSig()` to handle typed variant format (`{type, value}`) in addition to keyed variant format.
