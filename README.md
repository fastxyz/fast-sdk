# Fast SDK

Official TypeScript SDK for the Fast network. Build wallets, send tokens, check balances, sign messages, and interact with Fast in Node.js applications.

## Install

```bash
npm install @fastxyz/sdk
```

## Quick Start

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

// Create provider (read-only connection)
const provider = new FastProvider({ network: 'testnet' });

// Create or load wallet
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

// Check balance
const balance = await wallet.balance();
console.log(balance);

// Send tokens
const tx = await wallet.send({
  to: 'fast1...',
  amount: '1.0',
});
console.log(tx.txHash);
```

## Architecture

The SDK uses a Provider/Wallet separation:

- **FastProvider** — Read-only connection to the Fast network. No private key needed.
- **FastWallet** — Wallet for signing transactions. Requires a provider.

### Read-only operations (no key needed)

```ts
const provider = new FastProvider({ network: 'testnet' });
const balance = await provider.getBalance('fast1...');
const tokenInfo = await provider.getTokenInfo('fastUSDC');
```

### Signing operations (key required)

```ts
const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
await wallet.send({ to: 'fast1...', amount: '10' });
```

## Features

- **Wallet Management** - Create, load, or generate Fast wallets
- **Token Operations** - Send FAST, fastUSDC, or any Fast token
- **Balance Queries** - Check native and token balances
- **Message Signing** - Sign and verify messages with Ed25519
- **Token Metadata** - Look up token info and list holdings
- **Protocol Compatibility** - Submit transactions using the current `VersionedTransaction::Release20260303` FastSet envelope automatically

## Configuration

Network and token configuration is loaded from JSON files:

- **Bundled defaults**: `src/data/networks.json`, `src/data/tokens.json`
- **User overrides**: `~/.fast/networks.json`, `~/.fast/tokens.json`

User overrides take precedence over bundled defaults.
Pass `network: 'your-network-name'` to `FastProvider` for any key defined in `~/.fast/networks.json`.

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
