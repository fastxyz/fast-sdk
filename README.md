# Fast SDK

Official TypeScript SDK for the Fast network.

> **Work in progress** — This SDK is being actively refactored. The sections below cover the stable surface (`Address`, `Signer`, transaction encoding). Provider and other helper APIs are still being restructured.

## Packages

| Package | Description |
|---|---|
| `@fastxyz/sdk` | Core SDK — Node.js, browser, worker compatible |
| `@fastxyz/cli` | CLI tool for account utilities |

## Install

```bash
npm install @fastxyz/sdk
```

## Address

`Address` wraps a bech32m-encoded Fast address (`fast...`) backed by a 32-byte Ed25519 public key.

```ts
import { Address } from '@fastxyz/sdk';

// From a bech32m string
const addr = Address.fromString('fast...');

// Get raw bytes
const bytes: Uint8Array = addr.bytes;

// Serialize back to bech32m string
const str: string = addr.toString();

// As a plain number array
const arr: number[] = addr.bytesArray;
```

Low-level encode/decode functions are also exported:

```ts
import { encodeAddressToBech32m, decodeAddressFromBech32m } from '@fastxyz/sdk';
```

## Signer

`Signer` manages an Ed25519 private key and is isomorphic across Node.js, browsers, and workers.

```ts
import { Signer } from '@fastxyz/sdk';

// Create from a hex private key (0x-prefixed or raw)
const signer = new Signer('0x<64-char-hex>');

// Or from raw bytes
const signer = new Signer(privKeyBytes);
```

### Key & Address Derivation

```ts
const pubkey: Uint8Array = await signer.getPublicKey();
const pubkeyHex: string  = await signer.getPublicKeyHex();  // 0x-prefixed
const address: Address   = await signer.getAddress();

console.log(address.toString()); // fast...
```

### Signing

```ts
// Sign arbitrary bytes
const sig: Uint8Array = await signer.signMessage(messageBytes);

// Sign a VersionedTransaction — returns [txHash, signature]
// message = "VersionedTransaction::" + BCS(VersionedTransaction::Release20260319(tx))
const [hash, sig]: [string, Uint8Array] = await signer.signTransaction(tx);
```

### Verification

`Signer.verify` verifies an arbitrary message. `Signer.verifyTransaction` verifies a signed transaction
using the same domain prefix applied during signing. Both accept a public key (`Uint8Array`), an `Address`
instance, or a bech32m address string.

```ts
// Arbitrary message
const valid = await Signer.verify(signature, message, pubkeyBytes);
const valid = await Signer.verify(signature, message, address);    // Address instance
const valid = await Signer.verify(signature, message, 'fast...');  // bech32m string

// Transaction
const valid = await Signer.verifyTransaction(sig, tx, pubkeyBytes);
const valid = await Signer.verifyTransaction(sig, tx, 'fast...');
```

## Transactions

### Types

Transaction types are exported directly from the SDK:

```ts
import type { VersionedTransaction, Transaction20260319, ClaimType } from '@fastxyz/sdk';
```

### Building a transaction

```ts
import type { VersionedTransaction } from '@fastxyz/sdk';
import { TRANSACTION_VERSION_20260319 } from '@fastxyz/sdk';

const tx: VersionedTransaction = {
    [TRANSACTION_VERSION_20260319]: {
        network_id: 'mainnet',
        sender: pubkeyBytes,
        nonce: 1n,
        timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
        claim: { ExternalClaim: { /* ... */ } },
        archival: false,
        fee_token: null,
    },
};
```

### Hashing & serialization

```ts
import { hashTransaction, serializeVersionedTransaction } from '@fastxyz/sdk';

const hash: string      = hashTransaction(tx);            // 0x-prefixed keccak-256
const bytes: Uint8Array = serializeVersionedTransaction(tx);
```

## CLI

```bash
# Install globally or use via pnpm
pnpm cli generate
```

```
Generated new account:
  Address:     fast...
  Private Key: 0x...
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

---

> The following APIs (`FastProvider`, certificate helpers, amount utilities) are present in the codebase but are being refactored — documentation will be updated once the new design is stable.
