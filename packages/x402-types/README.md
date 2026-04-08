---
name: x402-types
description: >
  Shared types and utilities for the x402 HTTP Payment Protocol. Use when you need
  PaymentRequirement, PaymentPayload, VerifyResponse, SettleResponse, network config types,
  or utility functions (parsePrice, encodePayload, decodePayload). Zero runtime dependencies.
metadata:
  short-description: Shared x402 types, network config interfaces, and pure utility functions.
  compatibility: Node.js 20+, any TypeScript project.
---

# @fastxyz/x402-types

Shared types and utilities for the x402 HTTP Payment Protocol. Zero runtime dependencies.

This package provides the canonical type definitions used across `@fastxyz/x402-client`, `@fastxyz/x402-server`, and `@fastxyz/x402-facilitator`.

## Use Cases

Use this package when you need to reference x402 payment types (`PaymentRequirement`, `PaymentPayload`, `VerifyResponse`, etc.), define network configurations (`EvmChainConfig`, `FastNetworkConfig`), parse price strings into raw token units, encode/decode base64 JSON payloads for X-PAYMENT headers, or determine network type from a network name string.

Out of scope: making payments → use `@fastxyz/x402-client`; protecting API routes → use `@fastxyz/x402-server`; verifying/settling payments on-chain → use `@fastxyz/x402-facilitator`.

## Installation

```bash
pnpm add @fastxyz/x402-types
```

## Types

### Payment Types

| Type                   | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `PaymentRequirement`   | Payment requirement returned in a 402 response |
| `PaymentPayload`       | Decoded X-PAYMENT header payload               |
| `FastPayload`          | Fast transaction certificate payload           |
| `EvmPayload`           | EVM EIP-3009 authorization payload             |
| `VerifyResponse`       | Facilitator verify result                      |
| `SettleResponse`       | Facilitator settle result                      |
| `SupportedPaymentKind` | Facilitator /supported descriptor              |
| `NetworkType`          | `"evm" \| "fast" \| "svm"`                     |

### Network Config Types

| Type                | Description                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `EvmChainConfig`    | EVM chain config: `chainId`, `rpcUrl`, `usdcAddress`, optional `usdcName`/`usdcVersion` |
| `FastNetworkConfig` | Fast network config: `rpcUrl`, `usdcTokenId`                                            |

## Utilities

### `parsePrice(price, decimals?)`

Parse human-readable price strings into raw token units (default 6 decimals for USDC).

```typescript
import { parsePrice } from '@fastxyz/x402-types';

parsePrice('$0.10'); // "100000"
parsePrice('0.1 USDC'); // "100000"
parsePrice('100000'); // "100000" (passthrough)
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
getNetworkType('fast-testnet'); // "fast"
```

## Common Pitfalls

1. **Do not hardcode `decimals`** — `parsePrice` defaults to 6 (USDC); pass explicitly if using other tokens.
2. **Do not assume network names** — use `getNetworkType()` to determine if a network is `"evm"` or `"fast"`.
3. **Do not import network config values from this package** — this package only provides type definitions; actual config values are provided by the caller.

## Design

- **Zero runtime dependencies** — pure type definitions and utility functions
- **No hardcoded values** — network config types define the shape; callers provide actual values
- **Single source of truth** — all x402 packages import types from here
