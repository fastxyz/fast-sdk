---
"@fastxyz/sdk": minor
"@fastxyz/x402-client": patch
"@fastxyz/x402-facilitator": patch
---

Add built-in Fast network constants and require `networkId` in `FastProvider`.

### `@fastxyz/sdk`

**Breaking:** `ProviderOptions` now requires `networkId` in addition to `url`. Provide it explicitly or use the new built-in constants.

**New exports from `@fastxyz/sdk`:**

- `FastNetwork` — interface for defining a custom network (analogous to viem's `Chain`)

**New exports from `@fastxyz/sdk/networks`:**

- `mainnet` — built-in `FastNetwork` for the Fast mainnet (`fast:mainnet`), includes `defaultToken` (USDC)
- `testnet` — built-in `FastNetwork` for the Fast testnet (`fast:testnet`), includes `defaultToken` (testUSDC)
- `FastToken` — interface for token metadata `{ tokenId, symbol, decimals }`

**Before (v2.0):**
```ts
const provider = new FastProvider({ url: 'https://api.fast.xyz/proxy-rest' });
```

**After (v2.1):**
```ts
import { FastProvider } from '@fastxyz/sdk';
import { mainnet, testnet } from '@fastxyz/sdk/networks';

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
