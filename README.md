# Fast SDK

Official TypeScript SDK for the Fast network. Build wallets, send tokens, check balances, sign messages, and interact with Fast in Node.js applications.

## Install

```bash
npm install @fastxyz/sdk
```

## Quick Start

```ts
import { fast } from '@fastxyz/sdk';

const client = fast({ network: 'testnet' });
await client.setup();

// Check balance
const balance = await client.balance();
console.log(balance);

// Send tokens
const tx = await client.send({
  to: 'fast1...',
  amount: '1.0',
});
console.log(tx.txHash);
```

## Features

- **Wallet Management** - Create or load Fast wallets
- **Token Operations** - Send SET, fastUSDC, or any Fast token
- **Balance Queries** - Check native and token balances
- **Message Signing** - Sign and verify messages with Ed25519
- **Token Metadata** - Look up token info and list holdings

## Documentation

See [SKILL.md](./SKILL.md) for detailed API documentation and usage examples.

## Development

```bash
npm install
npm run build
npm test
```

## Releasing

See [RELEASING.md](./RELEASING.md) for the npm release workflow.

## License

MIT
