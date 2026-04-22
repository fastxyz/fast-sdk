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
| [@fastxyz/cli](app/cli/) | CLI tool — accounts, balances, sends, x402 payments |
| [@fastxyz/sdk](packages/fast-sdk/) | Core SDK — signing, transactions, REST queries |
| [@fastxyz/allset-sdk](packages/allset-sdk/) | AllSet SDK — bridge tokens between Fast and EVM |
| [@fastxyz/x402-client](packages/x402-client/) | Pay for x402-protected HTTP resources |
| [@fastxyz/x402-server](packages/x402-server/) | Protect API routes with x402 payments |
| [@fastxyz/x402-facilitator](packages/x402-facilitator/) | Verify and settle x402 payments on the network |
| [@fastxyz/fast-schema](packages/fast-schema/) | BCS/RPC/REST codec schemas |
| [@fastxyz/x402-types](packages/x402-types/) | Shared x402 protocol types |

## Links

| Resource | URL |
| --- | --- |
| [@fastxyz/sdk](packages/fast-sdk/) | Core Fast SDK — signing, transactions, provider, conversions |
| [@fastxyz/allset-sdk](packages/allset-sdk/) | AllSet SDK for bridge flows between Fast and EVM |
| [@fastxyz/x402-client](packages/x402-client/) | Client SDK for paying for x402-protected resources |
| [@fastxyz/x402-server](packages/x402-server/) | Server SDK for x402 payment verification / middleware |
| [@fastxyz/x402-facilitator](packages/x402-facilitator/) | Facilitator for verifying and settling x402 payments |
| [@fastxyz/cli](app/cli/) | CLI for account, network, balance, funding, send, and pay flows |
| [@fastxyz/schema](packages/fast-schema/) | Shared schema definitions for BCS, RPC, REST codecs, and types |
| [@fastxyz/x402-types](packages/x402-types/) | Shared types and utilities for the x402 protocol |

## Quick Start

### Which package do you need?

| Package | When to use it |
| ------- | -------------- |
| [@fastxyz/cli](app/cli/) | Terminal commands — accounts, balances, transfers, x402 payments |
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
import { mainnet } from '@fastxyz/sdk/networks';

const signer = new Signer('abcdef0123456789...');
const provider = new FastProvider(mainnet);

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
npm install -g @fastxyz/cli

# Or use via pnpm in the repo
pnpm cli --help
```

### Common Commands

```bash
# Create an account
fast account create --name my-account

# List accounts
fast account list

# Check balance for the current/default account
fast info balance

# Send tokens on Fast
fast send fast1recipient... 1000 --token USDC

# Fund via fiat on-ramp
fast fund fiat --network mainnet

# Pay for x402-protected resource
fast pay https://api.example.com/protected
```

The CLI source lives in `app/cli/`. Run `pnpm cli --help` or `pnpm cli <command> --help` for the current command reference.

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
