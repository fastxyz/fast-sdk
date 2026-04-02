---
name: x402-sdk
description: >
  x402 HTTP Payment Protocol SDK. Use when the user wants to pay for 402-protected content,
  protect API routes with payments, or run a facilitator service. Covers EVM (EIP-3009) and
  Fast payment flows, auto-bridging, and multi-network support. Single package with subpath
  exports: /client, /server, /facilitator.
metadata:
  short-description: Pay for APIs, protect routes, verify/settle payments.
  compatibility: Node.js 20+, Express-compatible frameworks.
---

# x402 SDK Skill

## When to Use This Skill

**USE this skill when the user wants to:**
- Pay for a 402-protected API endpoint
- Protect API routes with payment requirements
- Run a payment facilitator service
- Auto-bridge Fast → EVM USDC for EVM payments
- Verify or settle x402 payments

**DO NOT use this skill for:**
- General wallet operations → use `@fastxyz/fast-sdk`
- Token bridges without x402 → use `@fastxyz/allset-sdk`
- Non-payment HTTP requests

---

## Decision Tree: Which Subpath?

```
What is the user trying to do?
│
├── "Pay for content behind a 402 paywall"
│   └── import from '@fastxyz/x402-sdk/client'
│
├── "Protect my API with payments"
│   └── import from '@fastxyz/x402-sdk/server'
│
└── "Run a facilitator / verify payments"
    └── import from '@fastxyz/x402-sdk/facilitator'
```

---

## Workflows

### 1. Pay for 402 Content (Client)

**When:** User wants to access a 402-protected endpoint.

**Prerequisites:** Wallet with USDC (EVM) or USDC/testUSDC (Fast).

```typescript
import { x402Pay } from '@fastxyz/x402-sdk/client';
```

**Option A: EVM wallet (Ethereum Sepolia, Arbitrum, Base)**
```typescript
const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: {
    type: 'evm',
    privateKey: '0x...',
    address: '0x...',
  },
});
```

**Option B: Fast wallet**
```typescript
const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: {
    type: 'fast',
    privateKey: '...',     // 32-byte hex, no 0x
    publicKey: '...',      // 32-byte hex
    address: 'fast1...',
  },
});
```

**Option C: Both wallets (auto-bridge)**
```typescript
const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: [
    { type: 'fast', privateKey: '...', publicKey: '...', address: 'fast1...' },
    { type: 'evm', privateKey: '0x...', address: '0x...' },
  ],
  verbose: true,
});
```

Check result:
```typescript
if (result.success) {
  console.log('Content:', result.body);
  console.log('Paid:', result.payment?.amount);
}
```

---

### 2. Protect API Routes (Server)

**When:** User wants to require payment for API endpoints.

**Prerequisites:** Express app, facilitator service running.

```typescript
import express from 'express';
import { paymentMiddleware } from '@fastxyz/x402-sdk/server';

const app = express();

app.use(paymentMiddleware(
  '0xYourPaymentAddress...',
  {
    'GET /api/premium/*': { price: '$0.10', network: 'base' },
  },
  { url: 'http://localhost:4020' }
));

app.get('/api/premium/data', (req, res) => {
  res.json({ data: 'Premium content!' });
});

app.listen(3000);
```

**Multi-network setup:**
```typescript
app.use(paymentMiddleware(
  {
    evm: '0x...',
    fast: 'fast1...',
  },
  {
    'GET /api/evm/*': { price: '$0.10', network: 'base' },
    'GET /api/fast/*': { price: '$0.01', network: 'fast-testnet' },
  },
  { url: 'http://localhost:4020' }
));
```

---

### 3. Run a Facilitator

**When:** User needs to verify and settle payments for their server.

**Prerequisites:** EVM private key with ETH for gas.

```typescript
import express from 'express';
import { createFacilitatorServer } from '@fastxyz/x402-sdk/facilitator';

const app = express();
app.use(express.json());
app.use(createFacilitatorServer({
  evmPrivateKey: process.env.FACILITATOR_KEY as `0x${string}`,
}));

app.listen(4020, () => console.log('Facilitator on :4020'));
```

**Endpoints available:**
- `POST /verify` — Verify payment signature/certificate
- `POST /settle` — Settle EVM payment on-chain
- `GET /supported` — List supported payment kinds

---

### 4. Auto-Bridge Payment

**When:** User wants to pay EVM endpoint but only has USDC/testUSDC on Fast.

**Prerequisites:** Both Fast and EVM wallets configured.

```typescript
import { x402Pay } from '@fastxyz/x402-sdk/client';

const result = await x402Pay({
  url: 'https://api.example.com/evm-endpoint',
  wallet: [
    { type: 'fast', privateKey: '...', publicKey: '...', address: 'fast1...' },
    { type: 'evm', privateKey: '0x...', address: '0x...' },
  ],
  verbose: true,
});

// SDK automatically:
// 1. Detects EVM payment required
// 2. Checks EVM USDC balance
// 3. If insufficient, bridges Fast → EVM USDC (~3-4s)
// 4. Signs EIP-3009 authorization
// 5. Completes payment

if (result.payment?.bridged) {
  console.log('Bridge tx:', result.payment.bridgeTxHash);
}
```

---

## Supported Networks

### Mainnet

| Network | Type | Token |
|---------|------|-------|
| `fast-mainnet` | Fast | USDC |
| `arbitrum` | EVM | USDC |
| `base` | EVM | USDC |

### Testnet

| Network | Type | Token |
|---------|------|-------|
| `fast-testnet` | Fast | testUSDC |
| `ethereum-sepolia` | EVM | USDC |
| `arbitrum-sepolia` | EVM | USDC |

---

## Common Mistakes (DO NOT)

1. **DO NOT** hardcode private keys in source code:
   ```typescript
   // WRONG
   evmPrivateKey: '0xabc123...'
   
   // CORRECT
   evmPrivateKey: process.env.FACILITATOR_KEY as `0x${string}`
   ```

2. **DO NOT** forget `express.json()` before facilitator middleware:
   ```typescript
   // WRONG
   app.use(createFacilitatorServer({ ... }));
   
   // CORRECT
   app.use(express.json());
   app.use(createFacilitatorServer({ ... }));
   ```

3. **DO NOT** use wrong wallet type for network:
   ```typescript
   // WRONG: Fast wallet for EVM endpoint
   x402Pay({
     url: 'https://api.example.com/base-endpoint',
     wallet: { type: 'fast', ... },  // Won't work!
   });
   
   // CORRECT: EVM wallet for EVM endpoint, or use auto-bridge with both wallets
   ```

4. **DO NOT** forget to fund facilitator with ETH:
   - Facilitator needs ETH for gas on each EVM chain
   - No USDC needed (uses `transferWithAuthorization`)

5. **DO NOT** use old package names:
   ```typescript
   // WRONG (old separate packages)
   import { x402Pay } from '@fastxyz/x402-client';
   import { paymentMiddleware } from '@fastxyz/x402-server';
   
   // CORRECT (consolidated package with subpath exports)
   import { x402Pay } from '@fastxyz/x402-sdk/client';
   import { paymentMiddleware } from '@fastxyz/x402-sdk/server';
   ```

---

## Error Handling

| Error | Meaning | Fix |
|-------|---------|-----|
| `INSUFFICIENT_BALANCE` | Not enough USDC | Fund wallet or use auto-bridge |
| `INVALID_SIGNATURE` | Key/address mismatch | Verify wallet config |
| `BRIDGE_TIMEOUT` | Bridge took too long | Retry, check Fast balance |
| `authorization_already_used` | Nonce reused | Client must use fresh nonce |
| `facilitator_not_configured` | Missing private key | Set `evmPrivateKey` |

---

## Quick Reference

### Imports

```typescript
// Client
import { x402Pay } from '@fastxyz/x402-sdk/client';

// Server
import { paymentMiddleware } from '@fastxyz/x402-sdk/server';

// Facilitator
import { createFacilitatorServer, verify, settle } from '@fastxyz/x402-sdk/facilitator';
```

### Wallet Types

```typescript
// EVM
{ type: 'evm', privateKey: '0x...', address: '0x...' }

// Fast
{ type: 'fast', privateKey: '...', publicKey: '...', address: 'fast1...' }
```

### Route Config

```typescript
{
  'GET /api/premium/*': { price: '$0.10', network: 'base' },
  'POST /api/generate': { price: '$1.00', network: 'arbitrum' },
}
```
