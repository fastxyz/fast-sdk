---
name: x402-server
description: >
  x402 server SDK for protecting API routes with payment requirements. Provides Express
  middleware (paywall, paymentMiddleware) and payment verification/settlement helpers.
  All network config provided by the caller via RouteConfig — no hardcoded values.
metadata:
  short-description: Protect API routes with x402 payment requirements.
  compatibility: Node.js 20+, Express-compatible frameworks.
---

# x402-server Skill

## When to Use This Skill

**USE this skill when the user wants to:**

- Protect API routes with payment requirements (HTTP 402)
- Add payment middleware to an Express app
- Create payment requirements for specific routes
- Verify or settle payments via a facilitator

**DO NOT use this skill for:**

- Paying for 402-protected content → use `@fastxyz/x402-client`
- Running a facilitator service → use `@fastxyz/x402-facilitator`
- Shared x402 types only → use `@fastxyz/x402-types`

---

## Workflows

### 1. Protect routes with `paywall()`

```typescript
import express from 'express';
import { paywall, type RouteConfig, type FacilitatorConfig } from '@fastxyz/x402-server';

const app = express();

const facilitator: FacilitatorConfig = {
  url: 'https://facilitator.example.com',
};

const routes: Record<string, RouteConfig> = {
  '/premium': {
    price: '$0.10',
    network: 'fast-testnet',
    networkConfig: {
      asset: '0x...', // USDC token ID / address
      decimals: 6,
    },
    config: {
      description: 'Premium content',
    },
  },
};

app.use(paywall(routes, facilitator));

app.get('/premium', (req, res) => {
  res.json({ content: 'exclusive data' });
});
```

### 2. Use `paymentMiddleware()` for fine-grained control

```typescript
import { paymentMiddleware, type RouteConfig, type FacilitatorConfig } from '@fastxyz/x402-server';

const routeConfig: RouteConfig = {
  price: '$0.10',
  network: 'arbitrum-sepolia',
  networkConfig: {
    asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    decimals: 6,
    extra: { name: 'USD Coin', version: '2' },
  },
};

const facilitator: FacilitatorConfig = { url: 'https://facilitator.example.com' };

app.get('/data', paymentMiddleware(routeConfig, facilitator), (req, res) => {
  res.json({ data: 'paid content' });
});
```

### 3. Manual verify + settle

```typescript
import { verifyPayment, settlePayment, parsePaymentHeader } from '@fastxyz/x402-server';

const payload = parsePaymentHeader(req.headers['x-payment'] as string);
const verifyResult = await verifyPayment(payload, paymentRequirement, facilitator);

if (verifyResult.isValid) {
  const settleResult = await settlePayment(payload, paymentRequirement, facilitator);
}
```

---

## Common Mistakes

1. **DO NOT omit `networkConfig` in RouteConfig** — there are no hardcoded network defaults.
2. **DO NOT forget the `facilitator.url`** — the server needs a facilitator endpoint to verify/settle payments.
3. **DO NOT use raw token amounts in `price`** — use human-readable formats like `"$0.10"` or `"0.1 USDC"`.
4. **DO NOT hardcode asset addresses across environments** — pass them via `networkConfig` per route.

---

## Quick Reference

```typescript
// Imports
import { paywall, paymentMiddleware, verifyPayment, settlePayment, verifyAndSettle } from '@fastxyz/x402-server';
import type { RouteConfig, FacilitatorConfig, NetworkConfig, MiddlewareOptions } from '@fastxyz/x402-server';
```
