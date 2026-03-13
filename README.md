# Fast SDK

Official TypeScript SDK for the Fast network.

The package now has two entrypoints:

- `@fastxyz/sdk` for Node.js apps, keyfiles, and `~/.fast/*` config overrides
- `@fastxyz/sdk/browser` for browser and extension apps with no `node:*` dependency chain

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

```ts
import { FastBrowserWallet, FastProvider } from '@fastxyz/sdk/browser';

const provider = new FastProvider({ network: 'testnet' });
const wallet = FastBrowserWallet.fromInjected(window.fastset, provider);

await wallet.connect();

const tx = await wallet.send({
  to: 'fast1...',
  amount: '1',
});

console.log(tx.txHash);
console.log(tx.certificate);

const signed = await wallet.sign({ message: 'Hello from the browser' });
console.log(signed.signature);
console.log(signed.messageBytes);
```

## Architecture

- `FastProvider` is read-only and available from both entrypoints.
- `FastWallet` is Node-only and supports keyfiles, generated wallets, and private-key imports.
- `FastBrowserWallet` is browser-only and wraps an injected wallet such as `window.fastset`.

### Supported in `@fastxyz/sdk/browser`

- provider reads
- token and network config from bundled defaults or constructor overrides
- address helpers
- transaction hashing and certificate helpers
- injected-wallet `connect`, `sign`, `send`, and `submitClaim`

### Node-only

- `FastWallet`
- keyfile storage and `saveToKeyfile()`
- `~/.fast/networks.json` and `~/.fast/tokens.json`
- `FAST_CONFIG_DIR`
- env-seeded keyfile behavior

## Public Helpers

Browser-safe protocol helpers are exported from `@fastxyz/sdk/browser`:

- `pubkeyToAddress`, `addressToPubkey`, `normalizeFastAddress`
- `FAST_TOKEN_ID`, `FAST_DECIMALS`
- `hashTransaction`, `serializeVersionedTransaction`
- `getCertificateTransaction`, `getCertificateHash`, `getCertificateTokenTransfer`

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

Node entrypoint config precedence:

1. constructor overrides
2. `~/.fast/networks.json` and `~/.fast/tokens.json`
3. bundled defaults
4. hardcoded fallbacks

Browser entrypoint config precedence:

1. constructor overrides
2. bundled defaults
3. hardcoded fallbacks

## API Notes

- `wallet.send()` returns `{ txHash, certificate, explorerUrl }`
- `wallet.sign()` returns `{ signature, address, messageBytes }`
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
