# Fast Network in SDK Design

**Date:** 2026-04-22  
**Status:** Implemented

## Problem

The CLI's `app/cli/src/config/networks.json` mixed two concerns:

1. **Fast network core** — `url`, `explorerUrl`, `networkId` (belongs in the SDK)
2. **AllSet service config** — `allSet.crossSignUrl`, `allSet.portalApiUrl`, `allSet.chains` (CLI-specific)

Users of `@fastxyz/sdk` targeting mainnet or testnet had to hard-code URLs with no way to say "use mainnet".

## Goal

Give the SDK first-class `FastNetwork` definitions (like viem's chains), so:

```ts
import { FastProvider } from '@fastxyz/sdk';
import { mainnet, testnet } from '@fastxyz/sdk/networks';

const provider = new FastProvider(mainnet);
const provider = new FastProvider(testnet);
const provider = new FastProvider({ url: '...', networkId: 'fast:mainnet' });
```

## Design

### `FastNetwork` Interface

```ts
export interface FastNetwork {
  /** Proxy REST API base URL. */
  url: string;
  /** Network identifier (e.g. "fast:mainnet"). Optional — built-in constants always set it. */
  networkId?: NetworkId;
  /** Block explorer base URL (optional). */
  explorerUrl?: string;
  /** Default token for this network (optional). */
  defaultToken?: FastToken;
}

export interface FastToken {
  tokenId: string;   // hex "0x..."
  symbol: string;
  decimals: number;
}
```

`NetworkId` is `'fast:localnet' | 'fast:devnet' | 'fast:testnet' | 'fast:mainnet'` from `@fastxyz/schema`.

### Built-in Networks

```ts
// @fastxyz/sdk/networks
export const mainnet: FastNetwork = {
  url: 'https://api.fast.xyz/proxy-rest',
  explorerUrl: 'https://explorer.fast.xyz',
  networkId: 'fast:mainnet',
  defaultToken: { tokenId: '0xc655a123...', symbol: 'USDC', decimals: 6 },
};

export const testnet: FastNetwork = {
  url: 'https://testnet.api.fast.xyz/proxy-rest',
  explorerUrl: 'https://testnet.explorer.fast.xyz',
  networkId: 'fast:testnet',
  defaultToken: { tokenId: '0xd73a0679...', symbol: 'testUSDC', decimals: 6 },
};
```

### `ProviderOptions` (flat interface)

```ts
export interface ProviderOptions {
  url: string;
  networkId?: NetworkId;
  explorerUrl?: string;
}
```

`FastProvider` accepts any object satisfying this interface — including the built-in `mainnet`/`testnet` constants (which have `defaultToken` as well; extra fields are ignored by TypeScript structural typing).

### SDK Exports

`@fastxyz/sdk` root exports: `FastNetwork`, `FastToken` types only.

`@fastxyz/sdk/networks` subpath (like `viem/chains`) exports: `FastNetwork`, `FastToken`, `mainnet`, `testnet`.

### CLI Changes

- `networks.json` deleted and replaced by `config/networks.ts` — TypeScript file that imports `mainnet`/`testnet` from `@fastxyz/sdk/networks` and assembles full `NetworkConfig` objects with AllSet config inline.
- `services/config/app.ts` imports `package.json` directly to derive app `name` (from `bin` key) and `version`, eliminating the separate `config/app.json`.
- Custom user networks continue to use `NetworkConfigSchema` JSON validation unchanged.

## File Structure

```
packages/fast-sdk/src/
  networks/
    types.ts         ← FastToken + FastNetwork interfaces
    mainnet.ts       ← mainnet constant (with USDC defaultToken)
    testnet.ts       ← testnet constant (with testUSDC defaultToken)
    index.ts         ← re-exports (entry point for @fastxyz/sdk/networks)
  interface/
    provider.ts      ← flat ProviderOptions + FastProvider
  index.ts           ← exports FastNetwork, FastToken types

app/cli/src/
  config/
    networks.ts      ← assembles bundledNetworks from SDK constants + AllSet config
    app.json         ← DELETED (replaced by package.json import)
  services/config/
    app.ts           ← imports from package.json for name + version
```

## Backward Compatibility

- `ProviderOptions.networkId` is now optional (backward-compatible with v2.0).
- `provider.network` getter returns the `FastNetwork` object.
- `provider.url` getter preserved.

## Out of Scope

- AllSet config does not move to the SDK.
- `localnet` and `devnet` constants not added (can be added later).

