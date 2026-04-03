# @fastxyz/x402-facilitator

On-chain payment verification and settlement for the x402 HTTP Payment Protocol.

Supports:
- **EVM** — EIP-3009 `transferWithAuthorization` verification and settlement
- **Fast** — Ed25519 transaction certificate verification

## Installation

```bash
pnpm add @fastxyz/x402-facilitator
```

## Quick Start

### Standalone Server

```typescript
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';
import { arbitrumSepolia } from 'viem/chains';

const app = createFacilitatorServer({
  evmPrivateKey: '0x...',
  evmChains: {
    'arbitrum-sepolia': {
      chain: arbitrumSepolia,
      rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
      usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    },
  },
  fastNetworks: {
    'fast-testnet': {
      rpcUrl: 'https://rpc.testnet.fast.co',
      committeePublicKeys: ['abc123...', 'def456...'],
    },
  },
});

app.listen(4402, () => console.log('Facilitator running on :4402'));
```

### Mount in Existing App

```typescript
import express from 'express';
import { createFacilitatorRoutes } from '@fastxyz/x402-facilitator';

const app = express();
app.use(createFacilitatorRoutes(config));
// Exposes: POST /verify, POST /settle, GET /supported
```

## API

### `createFacilitatorServer(config)`

Create a standalone Express app with facilitator routes.

### `createFacilitatorRoutes(config)`

Create an Express Router with facilitator routes. Mount into an existing app.

**Routes:**
- `POST /verify` — verify a payment payload against a requirement
- `POST /settle` — settle a verified payment on-chain
- `GET /supported` — list supported payment kinds

### `verify(payload, requirement, config)`

Verify a payment payload. Returns `VerifyResponse`.

### `settle(payload, requirement, config)`

Settle a verified payment on-chain. Returns `SettleResponse`.

### `FacilitatorConfig`

```typescript
interface FacilitatorConfig {
  evmPrivateKey?: `0x${string}`;
  evmChains?: Record<string, FacilitatorEvmChainConfig>;
  fastNetworks?: Record<string, FacilitatorFastNetworkConfig>;
  debug?: boolean;
}

interface FacilitatorEvmChainConfig {
  chain: Chain;                  // viem Chain object
  rpcUrl: string;
  usdcAddress: `0x${string}`;
  usdcName?: string;
  usdcVersion?: string;
}

interface FacilitatorFastNetworkConfig {
  rpcUrl: string;
  committeePublicKeys: string[];  // Ed25519 public keys
}
```

## Design

- **No hardcoded network configs** — all chain info provided via `FacilitatorConfig`
- **Dual-network support** — EVM (EIP-3009) and Fast (Ed25519) in a single service
- **Flexible deployment** — standalone server or mounted routes
