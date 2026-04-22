# Fast Network in SDK Design

**Date:** 2026-04-22  
**Status:** Approved

## Problem

The CLI's `app/cli/src/config/networks.json` mixes two concerns:

1. **Fast network core** — `url`, `explorerUrl`, `networkId` (belongs in the SDK)
2. **AllSet service config** — `allSet.crossSignUrl`, `allSet.portalApiUrl`, `allSet.chains` (CLI-specific)

As a result, users of `@fastxyz/sdk` who want to target mainnet or testnet must hard-code URLs. There is no way to say "use mainnet" — only `new FastProvider({ url: "https://api.fast.xyz/proxy-rest" })`.

## Goal

Give the SDK first-class `FastNetwork` definitions (like viem's chains), so:

```ts
import { FastProvider, mainnet, testnet } from "@fastxyz/sdk";

const provider = new FastProvider({ network: mainnet });
const provider = new FastProvider({ network: testnet });
const provider = new FastProvider({ network: { url: "...", explorerUrl: "...", networkId: "..." } });
```

## Design

### `FastNetwork` Interface

```ts
export interface FastNetwork {
  /** Proxy REST API base URL. */
  url: string;
  /** Block explorer base URL. */
  explorerUrl: string;
  /** Network identifier, e.g. "fast:mainnet". */
  networkId: string;
}
```

### Built-in Networks

```ts
// packages/fast-sdk/src/networks/mainnet.ts
export const mainnet: FastNetwork = {
  url: "https://api.fast.xyz/proxy-rest",
  explorerUrl: "https://explorer.fast.xyz",
  networkId: "fast:mainnet",
};

// packages/fast-sdk/src/networks/testnet.ts
export const testnet: FastNetwork = {
  url: "https://testnet.api.fast.xyz/proxy-rest",
  explorerUrl: "https://testnet.explorer.fast.xyz",
  networkId: "fast:testnet",
};
```

### Updated `ProviderOptions`

```ts
export type ProviderOptions =
  | { network: FastNetwork; url?: never }     // primary (new)
  | { url: string; network?: never };          // legacy (backward compat)
```

`FastProvider` resolves the URL internally from `opts.network.url` or `opts.url`. It exposes a new `.network` getter returning a `FastNetwork` (for legacy `url`-only construction, `explorerUrl` and `networkId` are empty strings).

### SDK Exports

New exports from `@fastxyz/sdk` root:

```ts
export type { FastNetwork } from "./networks";
export { mainnet, testnet } from "./networks";
```

### CLI Changes

- `new FastProvider({ url: network.url })` → `new FastProvider({ network })`  
  where `network` is the CLI's `NetworkConfig` object (structurally compatible with `FastNetwork` since it has all three fields).
- `networks.json` and the `allSet`-related schemas stay in the CLI untouched.

## File Structure

```
packages/fast-sdk/src/
  networks/
    types.ts         ← FastNetwork interface
    mainnet.ts       ← mainnet constant
    testnet.ts       ← testnet constant
    index.ts         ← re-exports
  interface/
    provider.ts      ← updated ProviderOptions + FastProvider
  index.ts           ← new exports added
```

## Backward Compatibility

- `new FastProvider({ url: "..." })` continues to work (legacy branch).
- `provider.url` getter is preserved.
- New: `provider.network` getter returns the full `FastNetwork` object.

## Out of Scope

- AllSet config does not move to the SDK.
- No changes to x402 packages.
