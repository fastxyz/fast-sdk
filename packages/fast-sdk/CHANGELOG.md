# @fastxyz/sdk

## 2.3.1

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

## 2.3.0

### Minor Changes

- 7aad16b: Add the key-handover flow to `@fastxyz/sdk/wallet`. An agent calls `KeyHandoverAgent.generateAuthRequest()` to produce an HPKE-encrypted authorization request (an `auth_url` plus a 6-digit verification code); the user approves it in the Fast wallet, and `decryptAuthPayload()` turns the returned handover code into the account's ed25519 private key. Also exports the wallet-side helpers `parseAuthRequest` / `sealHandover` and the `KEY_HANDOVER_ERROR` codes. Uses HPKE Base mode — DHKEM(X25519, HKDF-SHA256) with AES-256-GCM — binding the ciphertext to the exact request bytes; `decryptAuthPayload` accepts either a bare base64url code or a quoted chat message.

### Patch Changes

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

## 2.2.0

### Minor Changes

- 00635d3: Add `@fastxyz/sdk/wallet` popup-window wallet module. Exposes `FastWalletClient` with `connect()` / `disconnect()` / `sign()`, opening a configurable popup origin (defaulting to `https://app.fast.xyz`) for user interaction and returning the result via `postMessage`. Dapps must supply `metadata` (name, origin, optional icon) so the popup UI can identify the requesting dapp. Configurable `signUrl` / `connectUrl` are composed via `URL` + `URLSearchParams`, so popup URLs that already carry query parameters or fragments are preserved. Origins (`dappOrigin` and `metadata.origin`) are strictly validated against `URL#origin`, so paths, queries, and fragments are rejected. Returned addresses are validated as bech32m `fast1...` strings whose decoded payload is exactly 32 bytes.

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
