---
name: x402-facilitator
description: >
  x402 payment facilitator for on-chain verification and settlement. Verify and settle
  payments for both EVM (EIP-3009 transferWithAuthorization) and Fast (Ed25519 transaction
  certificates) networks. Run as a standalone Express server or mount routes into an
  existing app. All network config provided via FacilitatorConfig — no hardcoded values.
metadata:
  short-description: Verify and settle x402 payments on-chain (EVM + Fast).
  compatibility: Node.js 20+, Express-compatible frameworks.
---

# x402-facilitator Skill

## When to Use This Skill

**USE this skill when the user wants to:**

- Run a payment facilitator service
- Verify x402 payment proofs on-chain
- Settle EVM EIP-3009 authorizations or Fast transaction certificates
- Mount facilitator API routes in an existing Express app

**DO NOT use this skill for:**

- Paying for 402-protected content → use `@fastxyz/x402-client`
- Protecting API routes → use `@fastxyz/x402-server`
- Shared x402 types only → use `@fastxyz/x402-types`

---

## Workflows

### 1. Run a standalone facilitator server

```typescript
import { createFacilitatorServer, type FacilitatorConfig } from '@fastxyz/x402-facilitator';
import { arbitrumSepolia } from 'viem/chains';

const config: FacilitatorConfig = {
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
};

const app = createFacilitatorServer(config);
app.listen(4402, () => console.log('Facilitator on :4402'));
```

### 2. Mount routes in an existing Express app

```typescript
import express from 'express';
import { createFacilitatorRoutes, type FacilitatorConfig } from '@fastxyz/x402-facilitator';

const app = express();
const config: FacilitatorConfig = { ... };

app.use(createFacilitatorRoutes(config));
// Adds: POST /verify, POST /settle, GET /supported
```

### 3. Use verify/settle directly

```typescript
import { verify, settle, type FacilitatorConfig } from '@fastxyz/x402-facilitator';

const verifyResult = await verify(paymentPayload, paymentRequirement, config);
if (verifyResult.isValid) {
  const settleResult = await settle(paymentPayload, paymentRequirement, config);
}
```

---

## Common Mistakes

1. **DO NOT omit `evmPrivateKey`** when settling EVM payments — the facilitator needs a key to call `transferWithAuthorization`.
2. **DO NOT omit `committeePublicKeys`** for Fast networks — required for Ed25519 signature verification.
3. **DO NOT pass chain IDs as strings** — `evmChains` values require a viem `Chain` object (import from `viem/chains`).
4. **DO NOT assume built-in networks** — all networks must be explicitly configured in `FacilitatorConfig`.

---

## Quick Reference

```typescript
// Imports
import { createFacilitatorServer, createFacilitatorRoutes, verify, settle } from '@fastxyz/x402-facilitator';
import type { FacilitatorConfig, FacilitatorEvmChainConfig, FacilitatorFastNetworkConfig } from '@fastxyz/x402-facilitator';

// FacilitatorConfig shape
const config: FacilitatorConfig = {
  evmPrivateKey: '0x...', // For EVM settlement
  evmChains: { '<network>': { chain, rpcUrl, usdcAddress } },
  fastNetworks: { '<network>': { rpcUrl, committeePublicKeys } },
  debug: true,
};
```
