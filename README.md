# Fast SDK

Official TypeScript SDK for the Fast network.

## Package Entrypoints

| Entrypoint | Use Case |
|------------|----------|
| `@fastxyz/sdk` | Node.js apps with keyfiles and `~/.fast/*` config |
| `@fastxyz/sdk/browser` | Browser apps with no Node dependencies |
| `@fastxyz/sdk/core` | Pure utilities only (address, BCS, certificates) |

## Install

```bash
npm install @fastxyz/sdk
```

## Node Quick Start

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

const tx = await wallet.send({
  to: 'fast1...',
  amount: '1',
});

console.log(tx.txHash);
console.log(tx.certificate);
console.log(tx.explorerUrl);

const signed = await wallet.sign({ message: 'Hello, Fast!' });
console.log(signed.signature);
console.log(signed.messageBytes);
```

## Browser Quick Start

### Create and Use a Wallet

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk/browser';

const provider = new FastProvider({ network: 'testnet' });

// Generate a new wallet
const wallet = await FastWallet.generate(provider);
console.log(wallet.address);     // fast1...
console.log(wallet.privateKey);  // Save this securely!

// Or restore from a saved private key
const wallet = await FastWallet.fromPrivateKey('abc123...', provider);

// Send tokens
const tx = await wallet.send({
  to: 'fast1recipient...',
  amount: '10',
  token: 'testUSDC',
});
console.log(tx.txHash);

// Sign a message
const signed = await wallet.sign({ message: 'Hello, Fast!' });
console.log(signed.signature);
```

### Persist Wallet in Browser

The browser wallet doesn't have file system access, so you must persist the private key yourself:

```ts
// Save (example using localStorage - use secure storage in production!)
localStorage.setItem('fast-wallet-key', wallet.privateKey);

// Restore
const savedKey = localStorage.getItem('fast-wallet-key');
if (savedKey) {
  const wallet = await FastWallet.fromPrivateKey(savedKey, provider);
}
```

### Read-only Provider Usage

```ts
import { FastProvider, getCertificateHash } from '@fastxyz/sdk/browser';

const provider = new FastProvider({ network: 'testnet' });
const balance = await provider.getBalance('fast1...', 'FAST');
console.log(balance.amount);

const certificate = await provider.getCertificateByNonce('fast1...', 1);
if (certificate) {
  console.log(getCertificateHash(certificate));
}
```

## Core Utilities Only

For pure helper functions without provider or wallet:

```ts
import { 
  pubkeyToAddress, 
  addressToPubkey,
  hashTransaction,
  getCertificateHash,
} from '@fastxyz/sdk/core';
```

## Architecture

### Directory Structure

```
src/
├── core/           # Pure, browser-safe utilities
│   ├── address.ts  # Fast address encoding/decoding
│   ├── bcs.ts      # BCS serialization
│   ├── bytes.ts    # Byte manipulation
│   └── ...
├── config/         # Configuration system
│   ├── source.ts   # ConfigSource interface (browser-safe)
│   ├── browser.ts  # Static config accessors
│   └── file-loader.ts  # File-based config (Node-only)
├── browser/        # Browser-specific implementations
│   ├── provider.ts # Browser FastProvider
│   └── index.ts    # Browser entrypoint
└── node/           # Node-specific implementations
    ├── provider.ts # Node FastProvider
    ├── wallet.ts   # FastWallet with keyfiles
    ├── keys.ts     # Ed25519 key management
    └── index.ts    # Node entrypoint
```

### What's in Each Entrypoint

| Export | `/core` | `/browser` | `.` (Node) |
|--------|---------|------------|------------|
| Address utils | ✅ | ✅ | ✅ |
| BCS/bytes | ✅ | ✅ | ✅ |
| Certificate helpers | ✅ | ✅ | ✅ |
| FastError | ✅ | ✅ | ✅ |
| FastProvider | ❌ | ✅ | ✅ |
| FastWallet | ❌ | ✅ (no keyfiles) | ✅ (with keyfiles) |
| `privateKey` getter | ❌ | ✅ | ❌ |
| Key utilities | ❌ | ❌ | ✅ |
| File config | ❌ | ❌ | ✅ |

### Browser vs Node FastWallet

| Feature | Browser | Node |
|---------|---------|------|
| `fromPrivateKey()` | ✅ | ✅ |
| `generate()` | ✅ | ✅ |
| `fromKeyfile()` | ❌ | ✅ |
| `saveToKeyfile()` | ❌ | ✅ |
| `privateKey` getter | ✅ | ❌ |
| `send()` / `sign()` / `submit()` | ✅ | ✅ |

### Node-only Features

- `FastWallet` with keyfile support
- `saveToKeyfile()` for wallet persistence
- `~/.fast/networks.json` and `~/.fast/tokens.json` config overrides
- `FAST_CONFIG_DIR` environment variable
- Ed25519 key generation and management

## Public Helpers

Available from all entrypoints:

- `pubkeyToAddress`, `addressToPubkey`, `normalizeFastAddress`
- `FAST_TOKEN_ID`, `FAST_DECIMALS`
- `hashTransaction`, `serializeVersionedTransaction`
- `getCertificateTransaction`, `getCertificateHash`, `getCertificateTokenTransfer`
- `bytesToHex`, `hexToBytes`, `bytesToPrefixedHex`

## Configuration

`FastProvider` accepts constructor-level config injection:

```ts
const provider = new FastProvider({
  network: 'custom',
  networks: {
    custom: {
      rpc: 'https://custom.example.com/proxy',
      explorer: 'https://custom.example.com/explorer',
    },
  },
  tokens: {
    MYTOKEN: {
      symbol: 'MYTOKEN',
      tokenId: '0x1234',
      decimals: 18,
    },
  },
});
```

**Node entrypoint config precedence:**

1. Constructor overrides
2. `~/.fast/networks.json` and `~/.fast/tokens.json`
3. Bundled defaults
4. Hardcoded fallbacks

**Browser entrypoint config precedence:**

1. Constructor overrides
2. Bundled defaults
3. Hardcoded fallbacks

## API Notes

- `wallet.send()` returns `{ txHash, certificate, explorerUrl }` on the Node `FastWallet`
- `wallet.sign()` returns `{ signature, address, messageBytes }` on the Node `FastWallet`
- `provider.submitTransaction(envelope)` exposes raw `proxy_submitTransaction`
- `provider.faucetDrip({ recipient, amount, token? })` exposes raw `proxy_faucetDrip`
- `provider.getTransactionCertificates(address, fromNonce, limit)` exposes raw `proxy_getTransactionCertificates`
- `provider.getCertificateByNonce(address, nonce)` fetches a certificate directly from RPC

## Development

```bash
npm install
npm run build
npm test
npm run pack:dry-run
npm run pack:smoke
```

## Releasing

See [RELEASING.md](./RELEASING.md).
