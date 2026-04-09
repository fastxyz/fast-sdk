---
name: x402-client
description: >
  x402 client SDK for paying for 402-protected content. Use when the user wants to call
  an API that returns HTTP 402 and automatically handle payment. Supports Fast networks,
  EVM networks (EIP-3009), and auto-bridge from Fast → EVM. All network config provided
  by the caller — no hardcoded values.
metadata:
  short-description: Pay for 402-protected APIs with Fast or EVM wallets.
  compatibility: Node.js 20+.
---

# @fastxyz/x402-client

Client SDK for the x402 HTTP Payment Protocol. Automatically handles HTTP 402 Payment Required responses by signing and paying for content.

Supports:

- **Fast networks** — via wallet `rpcUrl`
- **EVM networks** — via EIP-3009 transferWithAuthorization
- **Auto-bridge** — Fast USDC → EVM USDC when EVM balance insufficient

## Use Cases

- Pay for a 402-protected API endpoint
- Handle HTTP 402 Payment Required responses automatically
- Auto-bridge Fast USDC → EVM USDC for EVM payments
- Check Fast balance or bridge funds manually

**Out of scope:** Protecting API routes → [`@fastxyz/x402-server`](../x402-server) · Running a facilitator → [`@fastxyz/x402-facilitator`](../x402-facilitator) · General wallet operations → [`@fastxyz/sdk`](../fast-sdk)

## Installation

```bash
pnpm add @fastxyz/x402-client
```

## Quick Start

### Fast Payment

```typescript
import { x402Pay } from '@fastxyz/x402-client';

const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: {
    type: 'fast',
    privateKey: '0x...',
    address: 'fast1...',
    rpcUrl: 'https://rpc.testnet.fast.co',
  },
});

console.log(result.response); // Paid content
```

### EVM Payment

```typescript
import { x402Pay } from '@fastxyz/x402-client';

const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: {
    type: 'evm',
    privateKey: '0x...',
    address: '0x...',
  },
  evmNetworks: {
    'arbitrum-sepolia': {
      chainId: 421614,
      rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
      usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    },
  },
});
```

### Auto-Bridge (Fast → EVM)

When both wallet types and a `bridgeConfig` are provided, the client will automatically bridge Fast USDC to EVM if the EVM wallet has insufficient balance.

```typescript
const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: [fastWallet, evmWallet],
  evmNetworks: { ... },
  bridgeConfig: {
    rpcUrl: 'https://rpc.testnet.fast.co',
    fastBridgeAddress: '0x...',
    relayerUrl: 'https://relayer.example.com',
    crossSignUrl: 'https://crosssign.example.com',
    tokenEvmAddress: '0x...',
    tokenFastTokenId: '0x...',
    networkId: 'fast:testnet',
  },
});
```

## API

### `x402Pay(params: X402PayParams): Promise<X402PayResult>`

Main entry point. Fetches the URL, and if a 402 is returned, handles payment automatically.

**Parameters (`X402PayParams`):**

| Field          | Type                             | Required | Description                                     |
| -------------- | -------------------------------- | -------- | ----------------------------------------------- |
| `url`          | `string`                         | Yes      | URL of the 402-protected resource               |
| `method`       | `string`                         | No       | HTTP method (default: `GET`)                    |
| `headers`      | `Record<string, string>`         | No       | Custom headers                                  |
| `body`         | `string`                         | No       | Request body                                    |
| `wallet`       | `Wallet \| Wallet[]`             | Yes      | Wallet(s) for payment                           |
| `evmNetworks`  | `Record<string, EvmChainConfig>` | No\*     | EVM chain configs (\*required for EVM payments) |
| `bridgeConfig` | `BridgeConfig`                   | No       | Bridge config for auto-bridge                   |
| `verbose`      | `boolean`                        | No       | Enable verbose logging                          |

### `bridgeFastusdcToUsdc(fastWallet, evmWallet, amount, bridgeConfig)`

Manually bridge Fast USDC to EVM USDC.

```typescript
import { bridgeFastusdcToUsdc } from '@fastxyz/x402-client';

const result = await bridgeFastusdcToUsdc(
  fastWallet,
  evmWallet,
  '1000000', // amount in USDC smallest units
  bridgeConfig,
);
console.log(result.bridgeTxHash); // Bridge transaction hash
```

### `getFastBalance(wallet: FastWallet): Promise<bigint>`

Get USDC balance on the Fast network.

```typescript
import { getFastBalance } from '@fastxyz/x402-client';

const balance = await getFastBalance(fastWallet);
console.log('Fast USDC balance:', balance); // bigint (smallest units)
```

### Low-Level Utilities

#### `parse402Response(response: Response): Promise<PaymentRequired>`

Parse a raw HTTP 402 response into a typed `PaymentRequired` object. Throws if the response status is not 402.

```typescript
import { parse402Response } from '@fastxyz/x402-client';

const paymentReq = await parse402Response(response);
console.log(paymentReq.accepts); // Array of accepted payment methods
```

#### `buildPaymentHeader(payload: unknown): string`

Build a base64-encoded X-PAYMENT header value from a payment payload object. Useful for manual payment flows where you construct the payload yourself.

```typescript
import { buildPaymentHeader } from '@fastxyz/x402-client';

const header = buildPaymentHeader({
  x402Version: 1,
  scheme: 'exact',
  // ...payment payload fields
});
// Use as: headers['X-PAYMENT'] = header
```

#### `parsePaymentHeader(header: string): unknown`

Parse a base64-encoded X-PAYMENT header string back into a decoded object. Inverse of `buildPaymentHeader`.

```typescript
import { parsePaymentHeader } from '@fastxyz/x402-client';

const payload = parsePaymentHeader('eyJ4NDAyVmVyc2lvbiI6MS...');
```

## Common Pitfalls

1. **DO NOT omit `rpcUrl` on `FastWallet`** — it is required, not optional.
2. **DO NOT omit `evmNetworks` when using an EVM wallet** — the SDK has no hardcoded chains.
3. **DO NOT forget `bridgeConfig` when using auto-bridge** — it must include `networkId`.
4. **DO NOT pass a single wallet when auto-bridge is needed** — pass `[fastWallet, evmWallet]` as an array.

## Design

- **No hardcoded network configs** — all chain/network info provided via `evmNetworks` parameter
- **Wallet-type dispatch** — automatically routes to Fast or EVM handler based on `wallet.type`
- **Progressive enhancement** — start with a single wallet, add auto-bridge later
