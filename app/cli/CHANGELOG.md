# @fastxyz/cli

## 1.1.1

### Patch Changes

- 37e62af: Update the bundled mainnet `defaultToken` tokenId. The symbol remains
  `fastUSD`, but its `tokenId` changes from
  `0x125b60bb2e805336f0934077d4f9fdb36f45bec9ded8d7b0e637516cc43a86eb` to
  `0xc655a12330da6af361d281b197996d2bc135aaed3b66278e729c2222291e9130`.

  **Behavior change**: CLI commands that resolve the network's default
  token without an explicit `--token` flag (e.g. `fast send`, `fast info
balance`) and any `--token fastUSD` invocations on mainnet now operate
  against the new tokenId. The dedicated `fast fund fastusd` command is
  unaffected. Testnet default (`testUSDC`) is unchanged.

## 1.1.0

### Minor Changes

- 7aad16b: CLI: `send` and `fund usdc crypto` now resolve omitted `--token` to `network.defaultToken.symbol` (sourced from the SDK — `fastUSD` on mainnet, `testUSDC` on testnet) instead of silently falling back to the first chain's first token. When the resolved token isn't available on the targeted chain, the CLI errors with the new `CommandUnsupportedForTokenError` (exit code 2, `COMMAND_UNSUPPORTED_FOR_TOKEN`); typos still surface as `TokenNotFoundError`.

  The PR-#87 default-resolution helpers (`pickDefaultTokenName`, `resolveDefaultToken`, `selectSendTokenName`) and the CLI-only `fastTokens` map are removed in favor of the single SDK-driven path. Custom networks added via `fast network add` should now use `defaultToken` in their JSON.

  x402-client: `X402PayResult.payment.amount` for Fast payments now returns the raw integer string (smallest-unit form) instead of a hardcoded-6-decimals humanization. The wire format does not carry decimals; consumers should humanize using their own token-decimals registry. The CLI's `fast pay` command was updated to humanize for display.

  Also removes the broken `"… raw → … USDC"` diagnostic log line in `x402-client/src/fast.ts`.

- 8ecfb10: Add the encrypted key-handover flow.
  - `@fastxyz/sdk/wallet`: new `KeyHandoverAgent` (`generateAuthRequest` /
    `decryptAuthPayload`) implementing the HPKE Base / DHKEM(X25519,
    HKDF-SHA256) / AES-256-GCM protocol bound to the byte-exact request
    payload. Wallet-side `parseAuthRequest` / `sealHandover` helpers and
    `KEY_HANDOVER_ERROR` codes are exported. New `KeyHandoverAgent.exportPending()`
    / `restore()` enable cross-process flows. Fix: `decryptAuthPayload` now
    routes `INVALID_HANDOVER_CODE` distinctly from `MALFORMED_HANDOVER_MESSAGE`.
  - `@fastxyz/cli`: new `fast authorize request` / `fast authorize complete`
    commands that wrap the protocol so shell-based agents can obtain a Fast
    account private key without writing SDK glue. State is persisted at
    `~/.fast/handover-pending.json` (mode 0600, ~5 min, single-pending)
    between the two commands.

## 1.0.3

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

## 1.0.2

### Patch Changes

- 6b184ec: Breaking: Transaction format changed from single `claim` to `claims` array in Release20260407.
  Added TransactionVersionRegistry, SupportedTransactionVersions, and version-aware transaction building.
  Fixed x402 serialization format handling for Effect Schema decoded transactions.
  Updated x402-facilitator with version-agnostic BCS handling and format variant support.
  Internal dependency updates for allset-sdk.

## 1.0.1

### Patch Changes

- Fix CLI npm publish: include dist and drizzle migration files in package
