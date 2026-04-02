# @fastxyz/x402-server

Server SDK for the x402 HTTP Payment Protocol. Protect API routes with payment requirements using Express middleware.

## Installation

```bash
pnpm add @fastxyz/x402-server
```

## Quick Start

```typescript
import express from 'express';
import { paywall } from '@fastxyz/x402-server';

const app = express();

app.use(paywall(
  {
    '/premium': {
      price: '$0.10',
      network: 'fast-testnet',
      networkConfig: {
        asset: '0x...',
        decimals: 6,
      },
    },
  },
  { url: 'https://facilitator.example.com' },
));

app.get('/premium', (req, res) => {
  res.json({ content: 'exclusive data' });
});

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

### `paywall(routes, facilitator, options?)`

Express middleware that protects multiple routes with payment requirements.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `routes` | `Record<string, RouteConfig>` | Route path → payment config |
| `facilitator` | `FacilitatorConfig` | Facilitator endpoint (`{ url }`) |
| `options` | `MiddlewareOptions` | Optional config |

### `paymentMiddleware(routeConfig, facilitator, options?)`

Express middleware for a single route.

### `RouteConfig`

```typescript
interface RouteConfig {
  price: string;              // "$0.10", "0.1 USDC"
  network: string;            // "fast-testnet", "arbitrum-sepolia"
  networkConfig: NetworkConfig;
  config?: {
    description?: string;
    mimeType?: string;
    asset?: string;           // Override networkConfig.asset
  };
}

interface NetworkConfig {
  asset: string;     // USDC contract/token address
  decimals: number;  // Token decimals (typically 6)
  extra?: Record<string, unknown>;
}
```

### Low-Level Functions

- `createPaymentRequirement(routeConfig, payTo)` — create a `PaymentRequirement`
- `createPaymentRequired(requirements)` — format a 402 response body
- `verifyPayment(payload, requirement, facilitator)` — verify via facilitator
- `settlePayment(payload, requirement, facilitator)` — settle via facilitator
- `verifyAndSettle(payload, requirement, facilitator)` — verify then settle

## Design

- **No hardcoded network configs** — all asset info provided via `RouteConfig.networkConfig`
- **Facilitator-agnostic** — pass any facilitator URL; no embedded chain logic
- **Framework-compatible** — works with Express and compatible frameworks (req/res/next signature)
