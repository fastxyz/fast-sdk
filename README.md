# Fast SDK and CLI Monorepo

Official TypeScript SDK and CLI monorepo for the Fast network.

## Packages

| Package | Description |
| --- | --- |
| [@fastxyz/sdk](packages/fast-sdk/) | Core Fast SDK — signing, transactions, provider, conversions |
| [@fastxyz/allset-sdk](packages/allset-sdk/) | AllSet SDK for bridge flows between Fast and EVM |
| [@fastxyz/x402-client](packages/x402-client/) | Client SDK for paying for x402-protected resources |
| [@fastxyz/x402-server](packages/x402-server/) | Server SDK for x402 payment verification / middleware |
| [@fastxyz/x402-facilitator](packages/x402-facilitator/) | Facilitator for verifying and settling x402 payments |
| [@fastxyz/fast-cli](app/cli/) | CLI for account, network, balance, funding, send, and pay flows |
| [@fastxyz/fast-schema](packages/fast-schema/) | Shared schema definitions for BCS, RPC, REST codecs, and types |
| [@fastxyz/x402-types](packages/x402-types/) | Shared types and utilities for the x402 protocol |

See the package READMEs for package-specific documentation.

## Quick start

```bash
npm install @fastxyz/sdk
```

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

For more on the core SDK, see the [@fastxyz/sdk README](packages/fast-sdk/README.md).

## Development

This repository is a **pnpm workspace**.

```bash
pnpm install
pnpm build
pnpm test
```

## CLI

Show the available commands:

```bash
pnpm cli --help
```

Create a test account:

```bash
pnpm cli account create --name test1
```

List accounts:

```bash
pnpm cli account list
```

Current top-level CLI commands are:

- `account`
- `network`
- `info`
- `send`
- `fund`
- `pay`
