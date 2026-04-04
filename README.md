# Fast SDK

Official TypeScript SDK monorepo for the Fast network.

## Packages

| Package | Description |
| --- | --- |
| [@fastxyz/fast-sdk](packages/fast-sdk/) | High-level SDK — signing, transactions, provider, conversions |
| [@fastxyz/fast-schema](packages/fast-schema/) | Effect Schema definitions — BCS, RPC, REST codecs and type system |
| [@fastxyz/cli](app/cli/) | CLI tool for account utilities |

## Quick start

```bash
npm install @fastxyz/sdk
```

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

// 1. Create provider
const provider = new FastProvider({ network: 'testnet' });

// 2. Create wallet
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

// 3. Send tokens
const result = await wallet.send({
  to: 'fast1recipient...',
  amount: '1.5',
  token: 'testUSDC'
});

console.log('TX:', result.txHash);
console.log('Explorer:', result.explorerUrl);
```

See the [fast-sdk README](packages/fast-sdk/README.md) for full API documentation.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## CLI

```bash
pnpm cli generate
```

```text
Generated new account:
  Address:     fast...
  Private Key: 0x...
```
