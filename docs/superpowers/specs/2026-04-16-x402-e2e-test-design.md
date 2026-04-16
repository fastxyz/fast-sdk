# x402 E2E Test Design

## Problem

The x402 protocol has four packages (`x402-types`, `x402-client`, `x402-server`, `x402-facilitator`) that are tested in isolation but lack an end-to-end integration test that exercises the full payment flow against the real Fast testnet.

## Approach

Create a new `packages/x402-e2e/` package with a vitest e2e test that spins up two Express servers (facilitator + content server) in-process, then uses `x402Pay()` to exercise the full 402 payment flow against the real Fast testnet.

## Architecture

```
┌─────────────────┐     GET /premium      ┌──────────────────────┐
│                  │ ──────────────────▶   │                      │
│   x402-client    │     ◁── 402 ──────── │   Content Server     │
│   (x402Pay)      │                      │   (x402-server)      │
│                  │  GET /premium         │   paymentMiddleware  │
│                  │  + X-PAYMENT header   │                      │
│                  │ ──────────────────▶   │         │            │
│                  │                      │         ▼            │
│                  │     ◁── 200 ──────── │  POST /verify ──────▶│ Facilitator Server
│                  │                      │  POST /settle ──────▶│ (x402-facilitator)
└─────────────────┘                      └──────────────────────┘ createFacilitatorServer
```

## Components Under Test

| Package | What's exercised |
|---------|-----------------|
| `x402-types` | PaymentRequirement encoding/decoding, parsePrice, network type detection |
| `x402-client` | Full `x402Pay()` flow: initial request → parse 402 → sign Fast tx → retry with X-PAYMENT |
| `x402-server` | `paymentMiddleware()`: route matching, 402 generation, facilitator communication, header encoding |
| `x402-facilitator` | `createFacilitatorServer()`: HTTP endpoints, Fast BCS decoding, Ed25519 signature verification, certificate validation |

## Configuration

From `.env`:
- `FAST_TEST_RPC_URL` — Fast testnet RPC endpoint
- `FAST_TEST_SIGNER_PRIVATE_KEY` — Ed25519 private key (hex) for test wallet
- `FAST_TEST_NETWORK_ID` — `fast:testnet`

Hardcoded constants:
- USDC token ID on Fast testnet: `0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46`
- Network name for x402: `fast-testnet`
- Payment price: `$0.001` (1000 raw units, minimal to conserve test funds)
- Token decimals: 6

## Test Setup

### Wallet Derivation
Use `@fastxyz/sdk` `Signer` class to derive public key and Fast address from the private key in `.env`.

### Facilitator Server (Port A)
```ts
const facilitatorConfig = {
  fastNetworks: {
    'fast-testnet': {
      rpcUrl: FAST_TEST_RPC_URL,
      committeePublicKeys: [], // no trusted committee — rely on signature count + RPC cross-validation
    },
  },
  debug: false,
};
```
Express app with `createFacilitatorServer(facilitatorConfig)` middleware + `express.json()`.

### Content Server (Port B)
```ts
const payTo = { fast: recipientAddress }; // a second deterministic address
const routes = {
  'GET /premium': {
    price: '$0.001',
    network: 'fast-testnet',
    networkConfig: {
      asset: '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46',
      decimals: 6,
    },
  },
};
const facilitator = { url: `http://localhost:${facilitatorPort}` };
```
Express app with `paymentMiddleware()` + unprotected `GET /free` route + protected `GET /premium` route handler.

### Recipient Address
Derive a second Fast address from a hardcoded constant seed (e.g., `0x01...01` padded to 32 bytes) using `@fastxyz/sdk` Signer. This gives a deterministic, reproducible payTo address for the content server. Since this is testnet, the recipient doesn't need funds or a real operator.

## Test Cases

### 1. Baseline: Unprotected route returns 200
```
GET /free → 200 { message: "free content" }
```
Verifies the server is running and unprotected routes pass through.

### 2. Protected route without payment returns 402
```
GET /premium (no X-PAYMENT header) → 402
Response body: { error: "...", accepts: [PaymentRequirement] }
```
Verifies:
- Status code is 402
- `accepts` array has one entry
- Entry has correct network (`fast-testnet`), payTo, asset, and amount

### 3. Full payment flow via x402Pay
```ts
x402Pay({ url: premiumUrl, wallet: fastWallet })
```
Verifies:
- `result.success === true`
- `result.statusCode === 200`
- `result.body` contains the premium content
- `result.payment.network === 'fast-testnet'`
- `result.payment.txHash` is a non-empty string
- `result.payment.recipient` matches the configured payTo address
- `result.payment.amount` is `'0.001'`

## Package Structure

```
packages/x402-e2e/
├── package.json
├── tsconfig.json
├── tests/
│   └── fast-payment.test.ts
```

### Dependencies
- `@fastxyz/x402-client` — `x402Pay()`
- `@fastxyz/x402-server` — `paymentMiddleware()`
- `@fastxyz/x402-facilitator` — `createFacilitatorServer()`
- `@fastxyz/sdk` — `Signer`, `toFastAddress`
- `express` — HTTP server
- `vitest` — test runner
- `dotenv` — load `.env`

## Error Handling

- If `.env` is missing required vars, skip tests with a clear message.
- Server setup/teardown in `beforeAll`/`afterAll` with proper `server.close()`.
- Timeout: 60s for the payment test (involves real network calls).

## Considerations

- **Real money:** The test spends real testnet USDC ($0.001 per run). The test wallet must have sufficient balance.
- **Network dependency:** Tests require Fast testnet to be operational. If the network is down, tests fail.
- **No committee keys:** The facilitator verifies without a trusted committee list, relying on signature count (≥3) and optional RPC cross-validation. This is sufficient for testnet.
- **Idempotency:** Each test run creates a new on-chain transaction. Nonces are auto-incremented.
