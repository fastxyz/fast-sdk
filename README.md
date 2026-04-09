# Fast SDK and CLI Monorepo

Official TypeScript SDK and CLI for the [Fast network](https://fast.xyz).

## What is Fast?

Fast is a next-generation payment network built for:

- **AI agents** — autonomous transactions, micropayments, and network operations
- **High-frequency applications** — sub-second finality, super high TPS (more than 100k)
- **Cross-chain settlement** — bridge tokens between Fast and EVM chains via AllSet
- **HTTP-native payments** — pay for API resources with the x402 protocol

This monorepo provides everything you need to build on Fast from TypeScript/Node.js.

## Getting Started

**Start with the CLI.** It's the primary way to interact with the Fast network — all skill operations rely on it. Install it globally and use commands for accounts, balances, transfers, and x402 payments.

**Use the SDK when you're building an integration.** The SDK provides the `Signer`, `FastProvider`, and `TransactionBuilder` classes for programmatic control — useful for bots, AI agents, and custom workflows.

The monorepo contains multiple packages:

| Package | What it's for |
| ------- | ------------- |
| [@fastxyz/fast-cli](app/cli/) | CLI tool — accounts, balances, sends, x402 payments |
| [@fastxyz/sdk](packages/fast-sdk/) | Core SDK — signing, transactions, RPC queries |
| [@fastxyz/allset-sdk](packages/allset-sdk/) | AllSet SDK — bridge tokens between Fast and EVM |
| [@fastxyz/x402-client](packages/x402-client/) | Pay for x402-protected HTTP resources |
| [@fastxyz/x402-server](packages/x402-server/) | Protect API routes with x402 payments |
| [@fastxyz/x402-facilitator](packages/x402-facilitator/) | Verify and settle x402 payments on the network |
| [@fastxyz/fast-schema](packages/fast-schema/) | BCS/RPC/REST codec schemas |
| [@fastxyz/x402-types](packages/x402-types/) | Shared x402 protocol types |

## Links

| Resource | URL |
| --- | --- |
| **Documentation** | https://docs.fast.xyz |
| **GitHub** | https://github.com/fastxyz/fast-sdk |
| **NPM Org** | https://www.npmjs.com/org/fastxyz |

## Packages

| Package | Version | Description |
| --- | --- | --- |
| [@fastxyz/sdk](packages/fast-sdk/) | [![npm](https://img.shields.io/npm/v/@fastxyz/sdk)](https://www.npmjs.com/package/@fastxyz/sdk) | Core Fast SDK — signing, transactions, provider, address conversions |
| [@fastxyz/allset-sdk](packages/allset-sdk/) | [![npm](https://img.shields.io/npm/v/@fastxyz/allset-sdk)](https://www.npmjs.com/package/@fastxyz/allset-sdk) | Bridge tokens between Fast and EVM chains |
| [@fastxyz/x402-client](packages/x402-client/) | [![npm](https://img.shields.io/npm/v/@fastxyz/x402-client)](https://www.npmjs.com/package/@fastxyz/x402-client) | Client SDK for x402 HTTP payment protocol |
| [@fastxyz/x402-server](packages/x402-server/) | [![npm](https://img.shields.io/npm/v/@fastxyz/x402-server)](https://www.npmjs.com/package/@fastxyz/x402-server) | Server middleware for x402 payment verification |
| [@fastxyz/x402-facilitator](packages/x402-facilitator/) | [![npm](https://img.shields.io/npm/v/@fastxyz/x402-facilitator)](https://www.npmjs.com/package/@fastxyz/x402-facilitator) | Facilitator for x402 payment settlement |
| [@fastxyz/fast-schema](packages/fast-schema/) | [![npm](https://img.shields.io/npm/v/@fastxyz/fast-schema)](https://www.npmjs.com/package/@fastxyz/fast-schema) | Shared BCS/RPC schema definitions |
| [@fastxyz/x402-types](packages/x402-types/) | [![npm](https://img.shields.io/npm/v/@fastxyz/x402-types)](https://www.npmjs.com/package/@fastxyz/x402-types) | Shared types for x402 protocol |
| [@fastxyz/fast-cli](app/cli/) | [![npm](https://img.shields.io/npm/v/@fastxyz/fast-cli)](https://www.npmjs.com/package/@fastxyz/fast-cli) | CLI for accounts, balances, sends, and payments |

## Quick Start

### Which package do you need?

| Package | When to use it |
| ------- | -------------- |
| [@fastxyz/fast-cli](app/cli/) | Terminal commands — accounts, balances, transfers, x402 payments |
| [@fastxyz/sdk](packages/fast-sdk/) | Programmatic access — Signer, FastProvider, TransactionBuilder |
| [@fastxyz/allset-sdk](packages/allset-sdk/) | Cross-chain bridging — EVM ↔ Fast via AllSet |
| [@fastxyz/x402-client](packages/x402-client/) | Pay for 402-protected APIs (auto-handles HTTP 402) |
| [@fastxyz/x402-server](packages/x402-server/) | Protect your API routes with payment requirements |
| [@fastxyz/x402-facilitator](packages/x402-facilitator/) | Run a payment verification/settlement service |

### Install the SDK

```bash
npm install @fastxyz/sdk
```

### Build and Submit a Transaction

```ts
import { FastProvider, Signer, TransactionBuilder } from '@fastxyz/sdk';

const signer = new Signer('abcdef0123456789...');
const provider = new FastProvider({ rpcUrl: 'https://api.fast.xyz/proxy' });

const account = await provider.getAccountInfo({
  address: await signer.getPublicKey(),
  tokenBalancesFilter: null,
  stateKeyFilter: null,
  certificateByNonce: null,
});

const envelope = await new TransactionBuilder({
  networkId: 'fast:mainnet',
  signer,
  nonce: account.nextNonce,
})
  .addBurn({ tokenId: '11'.repeat(32), amount: 100n })
  .sign();

await provider.submitTransaction(envelope);
```

For more details, see the **[@fastxyz/sdk README](packages/fast-sdk/README.md)**.

## CLI

The Fast CLI provides command-line access to accounts, networks, transactions, and payments.

```bash
# Install globally
npm install -g @fastxyz/fast-cli

# Or use via pnpm in the repo
pnpm cli --help
```

### Common Commands

```bash
# Create an account
fast account create --name my-account

# List accounts
fast account list

# Check balance
fast info balance --address fast1...

# Send tokens
fast send --to fast1recipient... --amount 1000 --token 0x...

# Fund via fiat on-ramp
fast fund fiat --network mainnet

# Pay for x402-protected resource
fast pay https://api.example.com/protected --network mainnet
```

For full CLI documentation, see the **[CLI README](app/cli/README.md)**.

## Development

This is a **pnpm workspace** monorepo.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run CLI in development
pnpm cli --help
```

## Package Overview

### Core SDK

- **@fastxyz/sdk** — The main entry point for Fast network operations. Provides `Signer`, `FastProvider`, and `TransactionBuilder` for building, signing, and submitting transactions.

### Cross-Chain (AllSet)

- **@fastxyz/allset-sdk** — Bridge tokens between Fast and EVM chains. Supports deposits (EVM → Fast) and withdrawals/intents (Fast → EVM).

### x402 Payment Protocol

- **@fastxyz/x402-client** — Pay for HTTP resources protected by x402
- **@fastxyz/x402-server** — Server-side middleware to verify x402 payments
- **@fastxyz/x402-facilitator** — Settle and facilitate x402 payments

### Shared Infrastructure

- **@fastxyz/fast-schema** — BCS encodings, RPC types, REST codecs
- **@fastxyz/x402-types** — Shared types for the x402 protocol

## License

MIT
