---
"@fastxyz/sdk": minor
"@fastxyz/x402-client": patch
"@fastxyz/x402-facilitator": patch
---

Add built-in Fast network constants and require `networkId` in `FastProvider`.

### `@fastxyz/sdk`

**Breaking:** `ProviderOptions` now requires `networkId` in addition to `url`. Provide it explicitly or use the new built-in constants.

**New exports:**

- `mainnet` — built-in `FastNetwork` for the Fast mainnet (`fast:mainnet`)
- `testnet` — built-in `FastNetwork` for the Fast testnet (`fast:testnet`)
- `FastNetwork` — interface for defining a custom network (analogous to viem's `Chain`)

**Before (v2.0):**
```ts
const provider = new FastProvider({ url: 'https://api.fast.xyz/proxy-rest' });
```

**After (v2.1):**
```ts
import { FastProvider, mainnet, testnet } from '@fastxyz/sdk';

const provider = new FastProvider(mainnet);              // built-in mainnet
const provider = new FastProvider(testnet);              // built-in testnet
const provider = new FastProvider({                      // custom / explicit
  url: 'https://api.fast.xyz/proxy-rest',
  networkId: 'fast:mainnet',
});
```

### `@fastxyz/x402-client`

- `BridgeConfig.networkId` and `getFastBalance` options now use the `NetworkId` literal type (`'fast:localnet' | 'fast:devnet' | 'fast:testnet' | 'fast:mainnet'`) instead of `string`.

### `@fastxyz/x402-facilitator`

- `getExpectedFastNetworkId` return type narrowed from `string | null` to `NetworkId | null`.
