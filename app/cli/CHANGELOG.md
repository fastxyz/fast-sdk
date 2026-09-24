# @fastxyz/cli

## 1.3.1

### Patch Changes

- 040ce63: Allow importing an encrypted keystore from the original Rust multisig CLI with `fast account import --legacy-keystore`.

## 1.3.0

### Minor Changes

- 0333729: Add multisig support across the SDK and CLI.

  **SDK:** New `MultiSigSigner` class plus helpers `deriveMultiSigAddress`,
  `deriveMultiSigAddressBytes`, `assertAuthorizedSigner`. The signer
  produces a single partial signature wrapped in the on-wire `MultiSig`
  envelope; the proxy aggregates partials across cosigners. Tagged
  errors: `MultiSigConfigInvalidError`, `NotAuthorizedSignerError`.
  Signer addresses are canonicalized and validated in the same raw-byte order
  as the Rust implementation. Signers defensively copy key/config inputs and
  refuse envelopes whose sender is not the derived multisig address.

  **CLI:** New `fast multisig` command group (`init`, `import`, `export`,
  `pending`, `vote`). The `accounts` table is migrated to a tagged union
  (`single` | `multisig`). `fast send` is polymorphic on account kind for
  the Fast→Fast route. New `fast token create`, `fast token mint`,
  `fast token burn`, and `fast token manage` commands share the same
  single-signer/multisig submission pipeline. `fast account list` shows a
  `KIND` column.
  Rust `wallet.json` files can be imported. Pending transactions are restricted
  to the account's current nonce and rendered in full before voting; retrying an
  already-recorded partial is supported. Token management/mint commands perform
  local authority checks, unknown submit results fail closed, and Fast transfers
  accept a 32-byte `--memo`.

### Patch Changes

- d632ef2: Opt-in `allset/intent/v1` claim encoding. With `claimEncoding: 'v1'`, `chainId` and `bridgeContract`, `executeWithdraw` / `executeIntent` sign a self-describing canonical-JSON `claim_data` and tag the transfer's `user_data` with `allset/transfer/v1:<chainId>`, so the Fast App signing pop-up and the explorer can read what is authorized (AllSet#576). All v1 inputs are validated before the Fast transfer is signed. The default stays `'legacy'` until cross-sign and the Fast App decoder ship. New exports: `encodeIntentClaimV1`, `decodeIntentClaimV1`, `intentClaimV1ToAbi`, `intentV1ToLegacy`, `intentsToV1`, `prepareIntentClaimV1`, `finishIntentClaimV1`, `buildClaimBytes`, `transferUserDataTag`, `readTransferUserDataTag`, `bytes32ToFastAddress`, and the JSON Schema at `schemas/allset-intent-v1.json`. The CLI now passes `chainId`, `bridgeContract` and `display` from its network config (no behavior change yet).

## 1.2.0

### Minor Changes

- 58f0f9f: Bundle Arc mainnet (`arc`, chain 5042) in the mainnet network: AllSet bridge `0x8677EdAA...`, USDC `0x3600...0000` -> fastUSD, `gasToken: { symbol: "USDC", erc20Address: "0x3600...0000" }`.

  Chain configs accept an optional `gasToken`. When its `erc20Address` is the deposited token, `fund usdc crypto` requires the balance to cover the amount plus a fee reserve for approve + deposit, and reports the reserve; the "you will also need ETH" hint now names the chain's gas token.

  Route every bundled `evmRpcUrl` (testnet and mainnet) through the AllSet Portal's RPC proxy (`{portal}/chain/rpc/<chain>`) instead of embedding a dRPC key in the package. The previously embedded key is deactivated, so bundled EVM calls were failing; the proxy needs no key.

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
