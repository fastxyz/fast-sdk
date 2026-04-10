---
name: x402-facilitator
description: >
  x402 payment facilitator for network verification and settlement. Verify and settle
  payments for both EVM (EIP-3009 transferWithAuthorization) and Fast (Ed25519 transaction
  certificates) networks. Run as a standalone Express server or mount routes into an
  existing app. All network config provided via FacilitatorConfig — no hardcoded values.
metadata:
  short-description: Verify and settle x402 payments on the Fast and EVM networks.
  compatibility: Node.js 20+, Express-compatible frameworks.
---

# @fastxyz/x402-facilitator

Payment verification and settlement for the x402 HTTP Payment Protocol.

Supports:

- **EVM** — EIP-3009 `transferWithAuthorization` verification and settlement
- **Fast** — Ed25519 transaction certificate verification

## Use Cases

- Run a payment facilitator service
- Verify x402 payment proofs on the network
- Settle EVM EIP-3009 authorizations or Fast transaction certificates
- Mount facilitator API routes in an existing Express app

**Out of scope:** Paying for 402-protected content → [`@fastxyz/x402-client`](../x402-client) · Protecting API routes → [`@fastxyz/x402-server`](../x402-server)

## Installation

```bash
pnpm add @fastxyz/x402-facilitator
```

## Quick Start

### Standalone Server

```typescript
import express from 'express';
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';
import { arbitrumSepolia } from 'viem/chains';

const app = express();
app.use(express.json());

app.use(
  createFacilitatorServer({
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
      rpcUrl: 'https://api.fast.xyz/proxy',
      committeePublicKeys: ['abc123...', 'def456...'], // Ed25519 public keys used to verify Fast network transactions
    },
  },
  }),
);

app.listen(4402, () => console.log('Facilitator running on :4402'));
```

### Mount in Existing App

```typescript
import express from 'express';
import { createFacilitatorRoutes } from '@fastxyz/x402-facilitator';

const app = express();
const routes = createFacilitatorRoutes(config);

for (const route of routes) {
  app[route.method](route.path, route.handler);
}
// Exposes: POST /verify, POST /settle, GET /supported
```

## API

### `createFacilitatorServer(config)`

Create Express-compatible middleware that serves the facilitator endpoints.

```typescript
import express from 'express';
import { createFacilitatorServer } from '@fastxyz/x402-facilitator';

const app = express();
app.use(express.json());
app.use(createFacilitatorServer({ evmPrivateKey: '0x...', evmChains: { ... } }));
app.listen(4402);
```

### `createFacilitatorRoutes(config)`

Create route descriptors (`method`, `path`, `handler`) that you can attach to an existing app.

```typescript
import { createFacilitatorRoutes } from '@fastxyz/x402-facilitator';

const routes = createFacilitatorRoutes(config);
for (const route of routes) {
  app[route.method](`/facilitator${route.path}`, route.handler);
}
```

**Routes:**

- `POST /verify` — verify a payment payload against a requirement
- `POST /settle` — settle a verified payment on the network
- `GET /supported` — list supported payment kinds

### `verify(payload, requirement, config)`

Verify a payment payload against a payment requirement. Checks signature validity on the network (EIP-3009 for EVM, Ed25519 for Fast). Returns a `VerifyResponse` indicating whether the payment proof is valid and covers the required amount.

```typescript
import { verify } from '@fastxyz/x402-facilitator';

const result = await verify(payload, requirement, config);
if (result.isValid) {
  console.log('Payment verified for payer:', result.payer);
} else {
  console.log('Verification failed:', result.invalidReason);
}
```

### `settle(payload, requirement, config)`

Settle a previously verified payment on the network. For EVM payments, calls `transferWithAuthorization` to actually move the USDC. For Fast payments, records the settlement on the network. Returns a `SettleResponse`.

```typescript
import { settle } from '@fastxyz/x402-facilitator';

const settlement = await settle(payload, requirement, config);
if (settlement.success) {
  console.log('Payment settled:', settlement.txHash);
}
```

### `getNetworkId(network)`

Derive the chain ID number (e.g. `421614` for Arbitrum Sepolia) from a network name.

> Note: The `getNetworkId` function returns a **chain ID number** (e.g., `421614` for Arbitrum Sepolia), not the network ID string. The example below shows how to map a network name to a chain ID using the `evmChains` config.

```typescript
// import { arbitrumSepolia } from 'viem/chains'; // Uncomment if not already imported
import { getNetworkId } from '@fastxyz/x402-facilitator';

// The function returns a chain ID number (requires evmChains config to map network names to IDs)
// Without config, unknown networks return 0; with config, returns the chain ID number (from viem's chain definitions)
const id = getNetworkId('arbitrum-sepolia', {
  evmChains: {
    'arbitrum-sepolia': { chain: arbitrumSepolia, rpcUrl: '...', usdcAddress: '0x...' },
  },
});
// → 421614 (Arbitrum Sepolia chain ID)
```

### `FacilitatorConfig`

```typescript
interface FacilitatorConfig {
  evmPrivateKey?: `0x${string}`;
  evmChains?: Record<string, FacilitatorEvmChainConfig>;
  fastNetworks?: Record<string, FacilitatorFastNetworkConfig>;
  debug?: boolean;
}

interface FacilitatorEvmChainConfig {
  chain: Chain; // viem Chain object
  rpcUrl?: string;
  usdcAddress: `0x${string}`;
  usdcName?: string;
  usdcVersion?: string;
}

interface FacilitatorFastNetworkConfig {
  rpcUrl: string;
  committeePublicKeys: string[]; // Ed25519 public keys used to verify Fast network transactions
}
```

## Common Pitfalls

1. **DO NOT omit `evmPrivateKey`** when settling EVM payments — the facilitator needs a key to call `transferWithAuthorization`.
2. **DO NOT omit `committeePublicKeys`** for Fast networks — required for Ed25519 signature verification. These are the Ed25519 public keys used to verify Fast network transactions.
3. **DO NOT pass chain IDs as strings** — `evmChains` values require a viem `Chain` object (import from `viem/chains`).
4. **DO NOT assume built-in networks** — all networks must be explicitly configured in `FacilitatorConfig`.

## Design

- **No hardcoded network configs** — all chain info provided via `FacilitatorConfig`
- **Dual-network support** — EVM (EIP-3009) and Fast (Ed25519) in a single service
- **Flexible deployment** — standalone server or mounted routes
