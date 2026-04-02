# @fastxyz/x402-sdk

SDK for the x402 HTTP Payment Protocol — monetize APIs with crypto payments.

## What is x402?

x402 uses HTTP status code `402 Payment Required` to enable pay-per-request APIs:

- **No accounts needed** — just sign and pay
- **Instant settlement** — ~300ms on Fast, ~15s on EVM
- **Multi-chain** — Fast plus Arbitrum, Base, and Ethereum variants
- **Auto-bridge** — Fast → EVM USDC when needed

## Install

```bash
npm install @fastxyz/x402-sdk
```

All functionality is accessible via subpath imports:

```typescript
import { x402Pay } from '@fastxyz/x402-sdk/client';
import { paymentMiddleware } from '@fastxyz/x402-sdk/server';
import { createFacilitatorServer, verify, settle } from '@fastxyz/x402-sdk/facilitator';
```

---

## Quick Start

### 1. Pay for Content (Client)

```typescript
import { x402Pay } from '@fastxyz/x402-sdk/client';

const result = await x402Pay({
  url: 'https://api.example.com/premium',
  wallet: {
    type: 'evm',
    privateKey: '0x...',
    address: '0x...',
  },
});

console.log(result.body);  // Your paid content
```

### 2. Protect Your API (Server)

```typescript
import express from 'express';
import { paymentMiddleware } from '@fastxyz/x402-sdk/server';

const app = express();

app.use(paymentMiddleware(
  '0xYourAddress...',
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

### 3. Run a Facilitator

```typescript
import express from 'express';
import { createFacilitatorServer } from '@fastxyz/x402-sdk/facilitator';

const app = express();
app.use(express.json());
app.use(createFacilitatorServer({
  evmPrivateKey: process.env.FACILITATOR_KEY as `0x${string}`,
}));

app.listen(4020);
```

---

## Payment Flows

### EVM (Arbitrum, Base, Ethereum)

Uses **EIP-3009 `transferWithAuthorization`** — client signs, facilitator settles on-chain.

```
Client                          Server                         Facilitator
  │                               │                                │
  │ Sign EIP-3009 authorization   │                                │
  │──────────────────────────────>│  /verify                       │
  │                               │────────────────────────────────>│
  │                               │  { isValid: true }             │
  │                               │<────────────────────────────────│
  │                               │  /settle                       │
  │                               │────────────────────────────────>│
  │                               │  { txHash: 0x... }             │
  │  200 OK + content             │<────────────────────────────────│
  │<──────────────────────────────│                                │
```

### Fast (Instant Settlement)

Client submits transaction directly, sends **certificate** as proof. No settlement step needed.

```
Client                          Server                         Facilitator
  │                               │                                │
  │ Submit tx to Fast network     │                                │
  │ (already on-chain!)           │                                │
  │──────────────────────────────>│  /verify                       │
  │                               │────────────────────────────────>│
  │                               │  { isValid: true }             │
  │  200 OK + content             │<────────────────────────────────│
  │<──────────────────────────────│                                │
```

---

## Client Usage

### EVM Wallet

```typescript
const result = await x402Pay({
  url: 'https://api.example.com/data',
  wallet: {
    type: 'evm',
    privateKey: '0x...',
    address: '0x...',
  },
});
```

### Fast Wallet

```typescript
const result = await x402Pay({
  url: 'https://api.example.com/data',
  wallet: {
    type: 'fast',
    privateKey: '...',      // 32-byte Ed25519 key (hex, no 0x)
    publicKey: '...',       // 32-byte pubkey (hex)
    address: 'fast1...',    // bech32m address
  },
});
```

### Auto-Bridge (Fast → EVM)

Provide both wallets to automatically bridge from Fast to EVM USDC when paying EVM endpoints:

```typescript
const result = await x402Pay({
  url: 'https://api.example.com/data',  // EVM endpoint
  wallet: [
    {
      type: 'fast',
      privateKey: '...',
      publicKey: '...',
      address: 'fast1...',
    },
    {
      type: 'evm',
      privateKey: '0x...',
      address: '0x...',
    },
  ],
  verbose: true,  // See bridge progress
});
```

### Client Options

```typescript
interface X402PayParams {
  url: string;                    // URL to pay for
  wallet: Wallet | Wallet[];      // Wallet(s) to use
  method?: string;                // HTTP method (default: 'GET')
  headers?: Record<string, string>;
  body?: string;
  verbose?: boolean;              // Log progress
}
```

---

## Server Usage

### Single Payment Address

```typescript
app.use(paymentMiddleware(
  '0xYourAddress...',  // EVM or fast1...
  routes,
  { url: 'http://localhost:4020' }
));
```

### Multi-Network Addresses

Accept payments on both EVM and Fast:

```typescript
app.use(paymentMiddleware(
  {
    evm: '0xYourEvmAddress...',
    fast: 'fast1YourFastAddress...',
  },
  {
    'GET /api/evm/*': { price: '$0.10', network: 'base' },
    'GET /api/fast/*': { price: '$0.01', network: 'fast-testnet' },
  },
  { url: 'http://localhost:4020' }
));
```

### Route Configuration

```typescript
const routes = {
  'GET /api/premium': { price: '$0.10', network: 'base' },
  'GET /api/premium/*': { price: '$0.05', network: 'fast-testnet' },
  'POST /api/generate': { price: '$1.00', network: 'arbitrum' },
};
```

### Price Formats

All of these are equivalent ($0.10 USDC):

```typescript
{ price: '$0.10' }      // Dollar notation
{ price: '0.1' }        // Decimal USDC
{ price: '100000' }     // Raw units (6 decimals)
```

---

## Facilitator Usage

### Express Server

```typescript
import express from 'express';
import { createFacilitatorServer } from '@fastxyz/x402-sdk/facilitator';

const app = express();
app.use(express.json());
app.use(createFacilitatorServer({
  evmPrivateKey: process.env.FACILITATOR_KEY as `0x${string}`,
}));

app.listen(4020);
```

### As Library

```typescript
import { verify, settle } from '@fastxyz/x402-sdk/facilitator';

// Verify a payment
const verifyResult = await verify(paymentPayload, paymentRequirement);
if (!verifyResult.isValid) {
  console.error('Invalid:', verifyResult.invalidReason);
}

// Settle an EVM payment
const settleResult = await settle(paymentPayload, paymentRequirement, {
  evmPrivateKey: '0x...',
});
console.log('Settled:', settleResult.txHash);
```

### Facilitator Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/verify` | POST | Verify payment signature/certificate |
| `/settle` | POST | Settle payment on-chain (EVM only) |
| `/supported` | GET | List supported payment kinds |

### Facilitator Wallet Setup

The facilitator wallet needs:
- **ETH for gas** on each supported EVM chain
- **No USDC needed** (it calls `transferWithAuthorization`, not `transfer`)

---

## Supported Networks

### Mainnet

| Network | Type | Chain ID | Token | Settlement |
|---------|------|----------|-------|------------|
| `fast-mainnet` | Fast | — | USDC | ~300ms |
| `arbitrum` | EVM | 42161 | USDC | ~15s |
| `base` | EVM | 8453 | USDC | ~15s |

### Testnet

| Network | Type | Chain ID | Token | Settlement |
|---------|------|----------|-------|------------|
| `fast-testnet` | Fast | — | testUSDC | ~300ms |
| `ethereum-sepolia` | EVM | 11155111 | USDC | ~15s |
| `arbitrum-sepolia` | EVM | 421614 | USDC | ~15s |

---

## Troubleshooting

### Client Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `INSUFFICIENT_BALANCE` | Not enough USDC | Check balance, or use auto-bridge |
| `INVALID_SIGNATURE` | Key mismatch | Verify private key matches address |
| `BRIDGE_TIMEOUT` | Bridge took too long | Retry, check Fast wallet balance |

### Server Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Payment verification failed` | Bad signature/certificate | Check facilitator logs |
| `Settlement failed` | On-chain issue | Check facilitator has gas |

### Facilitator Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `authorization_already_used` | Nonce reused | Client must use fresh nonce |
| `insufficient_funds` | Payer has no USDC | Client needs to fund wallet |
| `facilitator_not_configured` | Missing private key | Set `evmPrivateKey` in config |

### Debug Mode

```typescript
const result = await x402Pay({
  url: '...',
  wallet: myWallet,
  verbose: true,  // Logs each step
});
result.logs?.forEach(console.log);
```

---

## Dependencies

- **[@fastxyz/fast-sdk](../fast-sdk)** — Fast RPC, transaction encoding, signing
- **[@fastxyz/fast-schema](../fast-schema)** — BCS encoding/decoding
- **[@fastxyz/allset-sdk](../allset-sdk)** — Bridge configs, USDC addresses, Fast token IDs

## License

MIT
