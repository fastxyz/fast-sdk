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

# x402-types Skill

## When to Use This Skill

**USE this skill when the user wants to:**
- Reference x402 payment types (PaymentRequirement, PaymentPayload, VerifyResponse, etc.)
- Define network configurations (EvmChainConfig, FastNetworkConfig)
- Parse price strings into raw token units
- Encode/decode base64 JSON payloads for X-PAYMENT headers
- Determine network type from a network name string

**DO NOT use this skill for:**
- Making payments → use `@fastxyz/x402-client`
- Protecting API routes → use `@fastxyz/x402-server`
- Verifying/settling payments on-chain → use `@fastxyz/x402-facilitator`

---

## Key Exports

### Types
- `PaymentRequirement` — 402 response payment requirement
- `PaymentPayload` — decoded X-PAYMENT header
- `FastPayload` — Fast transaction certificate payload
- `EvmPayload` — EVM EIP-3009 authorization payload
- `VerifyResponse` — facilitator verify result
- `SettleResponse` — facilitator settle result
- `SupportedPaymentKind` — facilitator /supported descriptor
- `NetworkType` — `"evm" | "fast" | "svm"`
- `EvmChainConfig` — caller-provided EVM chain config (chainId, rpcUrl, usdcAddress)
- `FastNetworkConfig` — caller-provided Fast network config (rpcUrl, usdcTokenId)

### Functions
- `parsePrice(price, decimals?)` — `"$0.10"` → `"100000"`
- `encodePayload(value)` — object → base64 JSON string
- `decodePayload<T>(encoded)` — base64 JSON string → T
- `getNetworkType(network)` — network name → `NetworkType`

---

## Workflows

### 1. Parse a price string

```typescript
import { parsePrice } from '@fastxyz/x402-types';

parsePrice('$0.10');       // "100000"
parsePrice('0.1 USDC');   // "100000"
parsePrice('100000');      // "100000" (passthrough)
```

### 2. Encode/decode payment payloads

```typescript
import { encodePayload, decodePayload } from '@fastxyz/x402-types';

const encoded = encodePayload({ x402Version: 1, scheme: 'exact', network: 'fast-testnet', payload: { ... } });
const decoded = decodePayload<PaymentPayload>(encoded);
```

### 3. Define network configs

```typescript
import type { EvmChainConfig, FastNetworkConfig } from '@fastxyz/x402-types';

const arbitrumConfig: EvmChainConfig = {
  chainId: 42161,
  rpcUrl: 'https://arb1.arbitrum.io/rpc',
  usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
};

const fastConfig: FastNetworkConfig = {
  rpcUrl: 'https://rpc.testnet.fast.co',
  usdcTokenId: '0x...',
};
```

---

## Common Mistakes

1. **DO NOT hardcode `decimals`** — `parsePrice` defaults to 6 (USDC), but pass explicitly if using other tokens.
2. **DO NOT assume network names** — use `getNetworkType()` to determine if a network is `"evm"` or `"fast"`.
3. **DO NOT import network configs from this package** — this package only provides *type definitions*. Actual config values are provided by the caller.
