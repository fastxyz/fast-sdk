# Fast SDK

Official TypeScript SDK for the Fast network.

This version is a minimal protocol SDK focused on:
- 1:1 proxy RPC calls via `FastProvider`
- transaction/message signing via `Signer`
- address/BCS/bytes/certificate helper functions

`FastProvider` requires an explicit `rpcUrl`. The SDK no longer includes built-in network or token config.

## Entrypoints

| Entrypoint | Status | Notes |
|---|---|---|
| `@fastxyz/sdk` | Primary | Node/browser compatible runtime behavior |
| `@fastxyz/sdk/core` | Helper-only | No provider class |

## Install

```bash
npm install @fastxyz/sdk
```

## Quick Start

```ts
import {
  FastProvider,
  Signer,
  FAST_NETWORK_IDS,
  FAST_TOKEN_ID,
} from '@fastxyz/sdk';

const provider = new FastProvider({
  rpcUrl: 'https://testnet.api.fast.xyz/proxy',
});

const signer = new Signer('0x<32-byte-private-key-hex>');
const senderPubkey = await signer.getPublicKey();

const transaction = {
  network_id: FAST_NETWORK_IDS.TESTNET,
  sender: senderPubkey,
  nonce: 1,
  timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
  claim: {
    TokenTransfer: {
      token_id: FAST_TOKEN_ID,
      recipient: senderPubkey,
      amount: '1',
      user_data: null,
    },
  },
  archival: false,
  fee_token: null,
};

const signature = await signer.signTransaction(transaction);

const result = await provider.submitTransaction({
  transaction,
  signature: { Signature: Array.from(signature) },
});

console.log(result);
```

## Provider API (Strict RPC 1:1)

`FastProvider` intentionally maps to proxy RPC endpoints only.

| SDK method | RPC method |
|---|---|
| `submitTransaction(envelope)` | `proxy_submitTransaction` |
| `faucetDrip({ recipient, amount, tokenId? })` | `proxy_faucetDrip` |
| `getAccountInfo({ address, tokenBalancesFilter?, stateKeyFilter?, certificateByNonce? })` | `proxy_getAccountInfo` |
| `getPendingMultisigTransactions(address)` | `proxy_getPendingMultisigTransactions` |
| `getTokenInfo(tokenIds)` | `proxy_getTokenInfo` |
| `getTransactionCertificates(address, fromNonce, limit)` | `proxy_getTransactionCertificates` |

### Notes

- `tokenId` and token filters are bytes/hex-oriented and must be 32-byte values.
- `getTransactionCertificates` enforces `limit` in range `1..200`.
- No symbol lookup (`USDC`, `testUSDC`) is performed by the SDK.
- Provider initialization is explicit: `new FastProvider({ rpcUrl })` is required.

## Signing API

`Signer` is isomorphic (Node + browser runtime) and supports:
- `getPublicKey()`
- `getAddress()`
- `sign(message)`
- `signTransaction(transaction)`
- `Signer.verify(signature, message, addressOrPubkey)`

Current transaction signing contract:
- message = `"VersionedTransaction::" + BCS(VersionedTransaction::Release20260319(tx))`

## Helper APIs

### Address
- `encodeFastAddress`
- `decodeFastAddress`
- `fastAddressToBytes`

### BCS / codec
- `serializeVersionedTransaction`
- `hashTransaction`
- `hexToTokenId`
- `tokenIdEquals`
- `FAST_TOKEN_ID`
- `FAST_DECIMALS`
- `FAST_NETWORK_IDS`

### Certificate
- `getCertificateTransaction`
- `getCertificateHash`
- `getCertificateTokenTransfer`

### Amount/bytes
- `toRaw`, `toHuman`, `toHex`, `fromHex`, `compareDecimalStrings`
- `bytesToHex`, `hexToBytes`, `bytesToPrefixedHex`, `stripHexPrefix`, `utf8ToBytes`

## Breaking Changes Migration

This release removes wallet/key/config convenience layers.

### Removed
- `FastWallet`
- keyfile/key management helpers
- local file config loader (`~/.fast/*` behavior)
- bundled default network/token config
- provider convenience methods such as:
  - `getBalance`
  - `getTokens`
  - `getCertificateByNonce`
  - `getExplorerUrl`
  - symbol-resolution helpers

### Migration pattern

Before:
```ts
const provider = new FastProvider({ network: 'testnet' }); // old API
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
await wallet.send({ to, amount: '1', token: 'FAST' });
```

After:
```ts
const provider = new FastProvider({ rpcUrl: 'https://testnet.api.fast.xyz/proxy' });
const signer = new Signer(privateKeyHex);

const tx = { /* build FastTransaction */ };
const sig = await signer.signTransaction(tx);

await provider.submitTransaction({
  transaction: tx,
  signature: { Signature: Array.from(sig) },
});
```

## Environment Compatibility

This SDK is intentionally isomorphic for the retained surface.

- Use `@fastxyz/sdk` in Node.js, browsers, workers, and CLI runtimes.
- The SDK avoids Node-only APIs in the reachable root graph.
- CLI can use the same provider/signer/helpers without a separate SDK layer.

## Development

```bash
npm install
npm run build
npm test
```

See `RELEASING.md` for release process and migration/release checks.
