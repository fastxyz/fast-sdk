# Fast SDK

Official TypeScript SDK monorepo for the Fast network.

## Packages

| Package                                       | Description                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| [@fastxyz/sdk](packages/fast-sdk/)       | High-level SDK — signing, transactions, provider, conversions     |
| [@fastxyz/fast-schema](packages/fast-schema/) | Effect Schema definitions — BCS, RPC, REST codecs and type system |
| [@fastxyz/cli](app/cli/)                      | CLI tool for account utilities                                    |

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
