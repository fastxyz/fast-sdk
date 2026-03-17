# Fast SDK

Official TypeScript SDK for the Fast network.

The package now has three entrypoints:

- `@fastxyz/sdk` for Node.js apps, keyfiles, and `~/.fast/*` config overrides
- `@fastxyz/sdk/browser` for browser-safe provider, config, and protocol helpers with no `node:*` dependency chain
- `@fastxyz/sdk/core` for pure Fast helpers with no provider or wallet surface

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
import { FastProvider, getCertificateHash } from '@fastxyz/sdk/browser';

const provider = new FastProvider({ network: 'testnet' });
const balance = await provider.getBalance('fast1...', 'FAST');
console.log(balance.amount);

const certificate = await provider.getCertificateByNonce('fast1...', 1);
if (certificate) {
  console.log(getCertificateHash(certificate));
}
```

## Core Quick Start

```ts
import {
  encodeFastAddress,
  decodeFastAddress,
  getCertificateHash,
} from '@fastxyz/sdk/core';
```

## Architecture

- `FastProvider` is the low-level Fast proxy client and is available from both entrypoints.
- `FastWallet` is Node-only and supports keyfiles, generated wallets, and private-key imports.
- `@fastxyz/sdk/browser` stays low-level and does not bundle browser wallet lifecycle or injected-wallet wrappers.
- `@fastxyz/sdk/core` is the pure helper surface for browser-safe protocol utilities.

### Supported in `@fastxyz/sdk/browser`

- provider reads and low-level proxy methods
- token and network config from bundled defaults or constructor overrides
- canonical Fast address codec helpers
- transaction hashing and certificate helpers

If your browser app uses an injected wallet such as `window.fastset`, keep that wrapper in app code or a separate client package.

If you are building a dapp-facing browser integration layer, keep that in `fast-connector` and build it on top of `@fastxyz/sdk/browser`.

### Node-only

- `FastWallet`
- keyfile storage and `saveToKeyfile()`
- `~/.fast/networks.json` and `~/.fast/tokens.json`
- `FAST_CONFIG_DIR`
- env-seeded keyfile behavior

## Public Helpers

`@fastxyz/sdk` and `@fastxyz/sdk/browser` both export the canonical Fast address codec helpers and the shared protocol helpers they need:

- `encodeFastAddress`, `fastAddressToBytes`, `decodeFastAddress`
- `FAST_TOKEN_ID`, `FAST_DECIMALS`
- `hashTransaction`, `serializeVersionedTransaction`

`@fastxyz/sdk/browser` also exports:

- `getCertificateTransaction`, `getCertificateHash`, `getCertificateTokenTransfer`

`@fastxyz/sdk/core` exports the pure helper set only:

- canonical address codec helpers
- amount helpers like `toHex()` and `fromHex()`
- BCS, byte, and certificate helpers
- shared Fast types and `FastError`

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
