# @fastxyz/x402-client

Client SDK for the x402 HTTP Payment Protocol. Automatically handles HTTP 402 Payment Required responses by signing and paying for content.

Supports:

- **Fast networks** — via wallet `rpcUrl`
- **EVM networks** — via EIP-3009 transferWithAuthorization
- **Auto-bridge** — Fast USDC → EVM USDC when EVM balance insufficient

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

### `getFastBalance(wallet: FastWallet): Promise<bigint>`

Get USDC balance on the Fast network.

## Design

- **No hardcoded network configs** — all chain/network info provided via `evmNetworks` parameter
- **Wallet-type dispatch** — automatically routes to Fast or EVM handler based on `wallet.type`
- **Progressive enhancement** — start with a single wallet, add auto-bridge later
