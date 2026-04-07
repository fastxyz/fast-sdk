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

# x402-client Skill

## When to Use This Skill

**USE this skill when the user wants to:**

- Pay for a 402-protected API endpoint
- Handle HTTP 402 Payment Required responses automatically
- Auto-bridge Fast USDC → EVM USDC for EVM payments
- Check Fast balance or bridge funds manually

**DO NOT use this skill for:**

- Protecting API routes with payments → use `@fastxyz/x402-server`
- Running a facilitator service → use `@fastxyz/x402-facilitator`
- General wallet operations → use `@fastxyz/sdk`

---

## Workflows

### 1. Pay with a Fast wallet

```typescript
import { x402Pay, type FastWallet } from '@fastxyz/x402-client';

const wallet: FastWallet = {
  type: 'fast',
  privateKey: '0x...',
  address: 'fast1...',
  rpcUrl: 'https://rpc.testnet.fast.co',
};

const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet,
});

console.log(result.response); // API response
```

### 2. Pay with an EVM wallet

```typescript
import { x402Pay, type EvmWallet } from '@fastxyz/x402-client';
import type { EvmChainConfig } from '@fastxyz/x402-types';

const wallet: EvmWallet = {
  type: 'evm',
  privateKey: '0x...',
  address: '0x...',
};

const evmNetworks: Record<string, EvmChainConfig> = {
  'arbitrum-sepolia': {
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
};

const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet,
  evmNetworks,
});
```

### 3. Pay with both wallets (auto-bridge)

```typescript
import { x402Pay, type FastWallet, type EvmWallet, type BridgeConfig } from '@fastxyz/x402-client';

const fastWallet: FastWallet = {
  type: 'fast',
  privateKey: '0x...',
  address: 'fast1...',
  rpcUrl: 'https://rpc.testnet.fast.co',
};

const evmWallet: EvmWallet = {
  type: 'evm',
  privateKey: '0x...',
  address: '0x...',
};

const bridgeConfig: BridgeConfig = {
  rpcUrl: 'https://rpc.testnet.fast.co',
  fastBridgeAddress: '0x...',
  relayerUrl: 'https://relayer.example.com',
  crossSignUrl: 'https://crosssign.example.com',
  tokenEvmAddress: '0x...',
  tokenFastTokenId: '0x...',
  networkId: 'fast:testnet',
};

const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: [fastWallet, evmWallet],
  evmNetworks: { ... },
  bridgeConfig,
});
```

### 4. Manual bridge

```typescript
import { bridgeFastusdcToUsdc, getFastBalance } from '@fastxyz/x402-client';

const balance = await getFastBalance(fastWallet);
const txHash = await bridgeFastusdcToUsdc(fastWallet, evmWallet, amount, bridgeConfig);
```

---

## Common Mistakes

1. **DO NOT omit `rpcUrl` on FastWallet** — it is required (not optional).
2. **DO NOT omit `evmNetworks` when using an EVM wallet** — the SDK has no hardcoded chains.
3. **DO NOT forget `bridgeConfig` when using auto-bridge** — it must include `networkId`.
4. **DO NOT pass a single wallet when auto-bridge is needed** — pass `[fastWallet, evmWallet]` as an array.

---

## Quick Reference

```typescript
// Imports
import { x402Pay, type FastWallet, type EvmWallet, type BridgeConfig, type X402PayParams, type X402PayResult } from '@fastxyz/x402-client';
import type { EvmChainConfig } from '@fastxyz/x402-types';
```
