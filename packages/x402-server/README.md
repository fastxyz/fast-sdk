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

# @fastxyz/x402-server

Server SDK for the x402 HTTP Payment Protocol. Protect API routes with payment requirements using Express middleware.

## Use Cases

- Protect API routes with payment requirements (HTTP 402)
- Add payment middleware to an Express app
- Create payment requirements for specific routes
- Verify or settle payments via a facilitator

**Out of scope:** Paying for 402-protected content → [`@fastxyz/x402-client`](../x402-client) · Running a facilitator service → [`@fastxyz/x402-facilitator`](../x402-facilitator)

## Installation

```bash
pnpm add @fastxyz/x402-server
```

## Quick Start

### Protect a Single Route with `paywall`

Use `paywall` to protect a single route with one price and network config:

```typescript
import express from 'express';
import { paywall } from '@fastxyz/x402-server';

const app = express();

app.use(
  paywall(
    { fast: 'fast1abc...' },  // payTo: Fast address
    {                         // RouteConfig for all requests
      price: '$0.10',
      network: 'fast-testnet',
      networkConfig: {
        asset: '0x...',      // USDC token address on the Fast network
        decimals: 6,
      },
    },
    { url: 'https://facilitator.example.com' }, // facilitator endpoint
  ),
);

app.get('/premium', (req, res) => {
  res.json({ content: 'exclusive data' });
});

app.listen(3000);
```

### Protect Multiple Routes with `paymentMiddleware`

Use `paymentMiddleware` to define different price configs per route:

```typescript
import express from 'express';
import { paymentMiddleware } from '@fastxyz/x402-server';

const app = express();

app.use(
  paymentMiddleware(
    { evm: '0x123...' },     // payTo: EVM address for all payments
    {                         // RoutesConfig: pattern → RouteConfig
      '/basic': {
        price: '$0.01',
        network: 'arbitrum-sepolia',
        networkConfig: { asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 },
      },
      '/premium': {
        price: '$0.10',
        network: 'arbitrum-sepolia',
        networkConfig: { asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 },
        config: { description: 'Premium tier content' },
      },
    },
    { url: 'https://facilitator.example.com' },
  ),
);

app.get('/basic', (req, res) => res.json({ tier: 'basic' }));
app.get('/premium', (req, res) => res.json({ tier: 'premium' }));

app.listen(3000);
```

## Payment Flow

```
Client                    Server                    Facilitator
  │                         │                           │
  ├── GET /premium ────────►│                           │
  │◄── 402 + PaymentReq ───┤                           │
  │                         │                           │
  ├── GET /premium ────────►│                           │
  │   (X-PAYMENT header)    ├── POST /verify ──────────►│
  │                         │◄── { isValid: true } ─────┤
  │                         │                           │
  │◄── 200 + content ──────┤                           │
  │                         ├── POST /settle ──────────►│
  │                         │◄── { success: true } ─────┤
```

## API

### `paywall(payTo, routeConfig, facilitator, options?)`

Express middleware that protects all routes with a single price and network config. Internally calls `paymentMiddleware` with `'*'` as the route pattern.

**Parameters:**

| Param         | Type                 | Description                                       |
| ------------ | -------------------- | ------------------------------------------------- |
| `payTo`       | `PayToConfig`        | Payment address — a string address or `{ fast?, evm? }` |
| `routeConfig` | `RouteConfig`        | Single price/network config applied to all routes |
| `facilitator` | `FacilitatorConfig`  | Facilitator endpoint (`{ url }`)                  |
| `options`     | `MiddlewareOptions`  | Optional debug/settings config                    |

```typescript
paywall(
  { fast: 'fast1abc...' },
  { price: '$0.10', network: 'fast-testnet', networkConfig: { asset: '0x...', decimals: 6 } },
  { url: 'https://facilitator.example.com' },
);
```

### `paymentMiddleware(payTo, routes, facilitator, options?)`

Express middleware for protecting multiple routes with different price configs. The `routes` parameter maps URL patterns to `RouteConfig` objects. Supports `*` wildcard in patterns and `METHOD /path` syntax for method-specific matching.

**Parameters:**

| Param         | Type                          | Description                                       |
| ------------ | ----------------------------- | ------------------------------------------------- |
| `payTo`       | `PayToConfig`                 | Payment address — a string address or `{ fast?, evm? }` |
| `routes`      | `Record<string, RouteConfig>` | Route pattern → payment config                    |
| `facilitator` | `FacilitatorConfig`          | Facilitator endpoint (`{ url }`)                  |
| `options`     | `MiddlewareOptions`           | Optional debug/settings config                    |

```typescript
paymentMiddleware(
  { evm: '0x123...' },
  {
    '/basic': { price: '$0.01', network: 'arbitrum-sepolia', networkConfig: { asset: '0x...', decimals: 6 } },
    '/premium': { price: '$0.10', network: 'fast-testnet', networkConfig: { asset: '0x...', decimals: 6 } },
  },
  { url: 'https://facilitator.example.com' },
);
```

### `RouteConfig`

```typescript
interface RouteConfig {
  price: string; // "$0.10", "0.1 USDC"
  network: string; // "fast-testnet", "arbitrum-sepolia"
  networkConfig: NetworkConfig;
  config?: {
    description?: string;
    mimeType?: string;
    asset?: string; // Override networkConfig.asset
  };
}

interface NetworkConfig {
  asset: string; // USDC contract/token address
  decimals: number; // Token decimals (typically 6)
  extra?: Record<string, unknown>;
}

### `FacilitatorConfig`

```typescript
interface FacilitatorConfig {
  /** Facilitator URL (e.g., "http://localhost:3002") */
  url: string;
  /** Optional factory for auth headers on verify/settle calls to the facilitator */
  createAuthHeaders?: () => Promise<{
    verify?: Record<string, string>;
    settle?: Record<string, string>;
  }>;
}
```

### Low-Level Functions

- `createPaymentRequirement(routeConfig, payTo)` — create a `PaymentRequirement`
- `createPaymentRequired(requirements)` — format a 402 response body
- `verifyPayment(payload, requirement, facilitator)` — verify via facilitator
- `settlePayment(payload, requirement, facilitator)` — settle via facilitator
- `verifyAndSettle(payload, requirement, facilitator)` — verify then settle

### Re-exported Express Types

The middleware module re-exports minimal Express-compatible types for use in type annotations:

```typescript
import type { Request, Response, NextFunction } from '@fastxyz/x402-server';
```

These are framework-compatible (Express, Koa, etc.) as long as they follow the same `method`, `path`, `header()`, `status()`, `json()`, `setHeader()` signature.

## Common Pitfalls

1. **DO NOT omit `networkConfig` in `RouteConfig`** — there are no hardcoded network defaults.
2. **DO NOT forget the `facilitator.url`** — the server needs a facilitator endpoint to verify/settle payments.
3. **DO NOT use raw token amounts in `price`** — use human-readable formats like `"$0.10"` or `"0.1 USDC"`.
4. **DO NOT hardcode asset addresses across environments** — pass them via `networkConfig` per route.

## Design

- **No hardcoded network configs** — all asset info provided via `RouteConfig.networkConfig`
- **Facilitator-agnostic** — pass any facilitator URL; no embedded chain logic
- **Framework-compatible** — works with Express and compatible frameworks (req/res/next signature)
