# @fastxyz/x402-types

Shared types and utilities for the x402 HTTP Payment Protocol. Zero runtime dependencies.

This package provides the canonical type definitions used across `@fastxyz/x402-client`, `@fastxyz/x402-server`, and `@fastxyz/x402-facilitator`.

## Installation

```bash
pnpm add @fastxyz/x402-types
```

## Types

### Payment Types

| Type | Description |
|------|-------------|
| `PaymentRequirement` | Payment requirement returned in a 402 response |
| `PaymentPayload` | Decoded X-PAYMENT header payload |
| `FastPayload` | Fast transaction certificate payload |
| `EvmPayload` | EVM EIP-3009 authorization payload |
| `VerifyResponse` | Facilitator verify result |
| `SettleResponse` | Facilitator settle result |
| `SupportedPaymentKind` | Facilitator /supported descriptor |
| `NetworkType` | `"evm" \| "fast" \| "svm"` |

### Network Config Types

| Type | Description |
|------|-------------|
| `EvmChainConfig` | EVM chain config: `chainId`, `rpcUrl`, `usdcAddress`, optional `usdcName`/`usdcVersion` |
| `FastNetworkConfig` | Fast network config: `rpcUrl`, `usdcTokenId` |

## Utilities

### `parsePrice(price, decimals?)`

Parse human-readable price strings into raw token units (default 6 decimals for USDC).

```typescript
import { parsePrice } from '@fastxyz/x402-types';

parsePrice('$0.10');       // "100000"
parsePrice('0.1 USDC');   // "100000"
parsePrice('100000');      // "100000" (passthrough)
```

### `encodePayload(value)` / `decodePayload<T>(encoded)`

Base64 JSON encoding/decoding for X-PAYMENT and X-PAYMENT-RESPONSE headers.

```typescript
import { encodePayload, decodePayload } from '@fastxyz/x402-types';

const encoded = encodePayload({ x402Version: 1, scheme: 'exact', ... });
const decoded = decodePayload(encoded);
```

### `getNetworkType(network)`

Determine network type from a network name string.

```typescript
import { getNetworkType } from '@fastxyz/x402-types';

getNetworkType('arbitrum-sepolia'); // "evm"
getNetworkType('fast-testnet');     // "fast"
```

## Design

- **Zero runtime dependencies** — pure type definitions and utility functions
- **No hardcoded values** — network config types define the shape; callers provide actual values
- **Single source of truth** — all x402 packages import types from here
