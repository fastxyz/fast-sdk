# @fastxyz/sdk

TypeScript SDK for the Fast network. Provides a high-level API for signing
transactions, querying the network, and converting addresses and amounts.

## Use Cases

- Build and sign Fast network transactions
- Query account balances, nonces, or token metadata
- Transfer tokens on the Fast network
- Create or burn tokens
- Sign or verify messages with an Ed25519 key
- Convert between hex, bytes, and bech32m addresses

**Out of scope:** Bridge flows (EVM ↔ Fast) → [`@fastxyz/allset-sdk`](../allset-sdk) · Token swaps, DEX operations, or generic EVM wallet operations

---

## Installation

```bash
npm install @fastxyz/sdk
```

## Core Concepts

| Class                | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `Signer`             | Holds an Ed25519 private key, signs messages |
| `FastProvider`       | REST client for the Fast proxy API           |
| `TransactionBuilder` | Fluent builder for all transaction types     |

**Typical flow:** Create Signer → Create Provider → Get account info → Build transaction → Sign → Submit.

---

## Workflows

### 1. Create a Signer

```ts
import { Signer } from '@fastxyz/sdk';

// From a 32-byte hex private key (0x prefix optional)
const signer = new Signer('abcdef0123456789...');

// Or from raw bytes or a number array
const signer = new Signer(new Uint8Array(32));

const pubKey = await signer.getPublicKey(); // Uint8Array (32)
const address = await signer.getFastAddress(); // "fast1..."
```

### 2. Connect to the Network

```ts
import { FastProvider, mainnet, testnet } from '@fastxyz/sdk';

// Use a built-in network constant (recommended)
const provider = new FastProvider(mainnet);
const provider = new FastProvider(testnet);

// Or supply a custom network
const provider = new FastProvider({
  url: 'https://api.fast.xyz/proxy-rest',
  networkId: 'fast:mainnet',
});
```

The built-in `mainnet` and `testnet` constants satisfy `ProviderOptions` directly and carry the correct `url`, `networkId`, and `explorerUrl`.

### 3. Check Account Info

```ts
const account = await provider.getAccountInfo({
  address: pubKey, // Uint8Array, hex string, or bech32m
});

console.log('Native balance:', account.balance);
console.log('Token balances:', account.tokenBalance); // [tokenId, amount][] pairs
console.log('Next nonce:', account.nextNonce);
```

Optional filters (all default to `null` if omitted):

```ts
const account = await provider.getAccountInfo({
  address: pubKey,
  tokenBalancesFilter: [tokenIdBytes],
  stateKeyFilter: [stateKeyBytes],
  certificateByNonce: { start: 0n, limit: 10 },
});
```

### 4. Transfer Tokens

```ts
import { TransactionBuilder } from '@fastxyz/sdk';

const account = await provider.getAccountInfo({ address: pubKey });

const envelope = await new TransactionBuilder({
  networkId: 'fast:mainnet',
  signer,
  nonce: account.nextNonce,
})
  .addTokenTransfer({
    tokenId: '11'.repeat(32),
    recipient: 'fast1recipient...',
    amount: 1000n,
    userData: null,
  })
  .sign();

const result = await provider.submitTransaction(envelope);
```

### 5. Build Other Transaction Types

`TransactionBuilder` supports 10 builder methods via fluent chaining. Single operations produce a direct claim; multiple operations are automatically batched.

```ts
const builder = new TransactionBuilder({ networkId, signer, nonce });

builder.addTokenCreation({ tokenName, decimals, initialAmount, mints, userData });
builder.addTokenManagement({ tokenId, updateId, newAdmin, mints, userData });
builder.addMint({ tokenId, recipient, amount });
builder.addBurn({ tokenId, amount });
builder.addStateInitialization({ key, initialState });
builder.addStateUpdate({ key, previousState, nextState, computeClaimTxHash, computeClaimTxTimestamp });
builder.addStateReset({ key, resetState });
// verifierCommittee = addresses of verifiers, verifierQuorum = minimum signatures needed, claimData = the claim being verified
builder.addExternalClaim({ claim: { verifierCommittee, verifierQuorum, claimData }, signatures });
// Informs the network that the account is leaving the verifier set.
builder.addLeaveCommittee();

// Batch multiple operations
builder.addBurn({ tokenId, amount: 100n }).addBurn({ tokenId, amount: 200n });

const envelope = await builder.sign();
```

**Builder reuse:** Call `builder.reset()` to clear operations, then `builder.setNonce(newNonce)` for the next transaction.

### 6. Sign and Verify Messages

```ts
// Sign raw bytes
const sig = await signer.signMessage(messageBytes);

// Sign BCS-encoded typed data (domain-prefixed)
const sig = await signer.signTypedData(bcsType, data);

// Verify
import { verify, verifyTypedData } from '@fastxyz/sdk';

const valid = await verify(sig, messageBytes, pubKey);
const valid = await verifyTypedData(sig, bcsType, data, pubKey);
```

### 7. Query Certificates and Token Metadata

```ts
// Get finalized transaction certificates
const certs = await provider.getTransactionCertificates({
  address: pubKey,
  fromNonce: 0n,
  limit: 10,
});

// Get token metadata
const tokenInfo = await provider.getTokenInfo({ tokenIds: [tokenIdBytes] });

// Get pending multisig transactions
const pending = await provider.getPendingMultisigTransactions({ address: pubKey });
```

---

## API Reference

### Signer

Ed25519 signer that accepts private keys as hex strings, `Uint8Array`, or `number[]`.

```ts
const signer = new Signer(privateKey);
const pubKey = await signer.getPublicKey(); // 32-byte Ed25519 public key
const address = await signer.getFastAddress(); // "fast1..."
const sig = await signer.signMessage(message); // 64-byte signature
const sig = await signer.signTypedData(bcsType, data); // BCS domain-prefixed
```

Standalone verification:

```ts
import { verify, verifyTypedData } from '@fastxyz/sdk';
const valid = await verify(signature, message, publicKey);
```

### FastProvider

Typed REST client for the Fast proxy API.

```ts
import { FastProvider, mainnet, testnet } from '@fastxyz/sdk';

// Built-in network constants (recommended)
const provider = new FastProvider(mainnet);
const provider = new FastProvider(testnet);

// Custom network
const provider = new FastProvider({
  url: 'https://mynode.example.com',
  networkId: 'fast:mainnet',
  explorerUrl: 'https://explorer.fast.xyz', // optional
});
```

| Method                                   | Description                                 |
| ---------------------------------------- | ------------------------------------------- |
| `submitTransaction(envelope)`            | Submit a signed transaction                 |
| `getAccountInfo(params)`                 | Fetch balance, nonce, token balances, state |
| `getTokenInfo(params)`                   | Fetch token metadata                        |
| `getTransactionCertificates(params)`     | Fetch finalized certificates                |
| `getPendingMultisigTransactions(params)` | Fetch pending multisig txs                  |
| `getEscrowJob(params)`                   | Fetch a single escrow job by ID             |
| `getEscrowJobs(params)`                  | List escrow jobs by role and status          |

### TransactionBuilder

Fluent builder for all 10 operation types. Single operations produce a direct
claim type; multiple operations are automatically batched.

```ts
const builder = new TransactionBuilder({ networkId, signer, nonce });

builder.addTokenTransfer({ tokenId, recipient, amount: 1000n, userData: null }).addBurn({ tokenId, amount: 500n });

const envelope = await builder.sign(); // Batch of 2 operations
```

Supported operations: `addTokenTransfer`, `addTokenCreation`,
`addTokenManagement`, `addMint`, `addBurn`,
`addStateInitialization`, `addStateUpdate`, `addStateReset`,
`addExternalClaim`, `addLeaveCommittee`, `addEscrow`.

### Conversion Utilities

```ts
import { toHex, fromHex, toFastAddress, fromFastAddress } from '@fastxyz/sdk';

toHex(bytes); // "0x..."
fromHex('0xabcd'); // Uint8Array
toFastAddress(pubKey); // "fast1..."
fromFastAddress('fast1...'); // Uint8Array
```

### BCS Encoding

```ts
import { encode, hash, hashHex, getTokenId } from '@fastxyz/sdk';

const bytes = await encode(bcsSchema, data);
const h = await hashHex(bcsSchema, data); // "0x..." hash output
const tokenId = getTokenId(sender, nonce, 0n); // deterministic token ID
```

### Error Handling

All errors are typed and can be matched with `instanceof`:

```ts
import { UnexpectedNonceError, InsufficientFundingError } from '@fastxyz/sdk';

try {
  await provider.submitTransaction(envelope);
} catch (e) {
  if (e instanceof UnexpectedNonceError) {
    console.log('Expected nonce:', e.expectedNonce);
  }
}
```

Error hierarchy: Network → REST → Proxy → Validators

## Development

```bash
pnpm build        # Build this package
pnpm turbo test   # Run the repo test pipeline
```

## Migrating to v2.0.0

### Breaking Changes

**Default transaction version changed to Release20260407**

`TransactionBuilder` now defaults to `Release20260407` which uses a `claims` array instead of a single `claim`.

**Before (v1.x):**
```ts
const builder = new TransactionBuilder({ networkId, signer, nonce });
builder.addBurn({ tokenId, amount });
const envelope = await builder.sign();
// Produced: { claim: { Burn: { ... } } }
```

**After (v2.0):**
```ts
const builder = new TransactionBuilder({ networkId, signer, nonce });
builder.addBurn({ tokenId, amount });
const envelope = await builder.sign();
// Produces: { claims: [{ Burn: { ... } }] }
```

**REST API migration**: `FastProvider` now uses REST endpoints. `ProviderOptions.rpcUrl` is renamed to `url`. Proxy paths changed from `/proxy` to `/proxy-rest`.

**Before (v1.x):**
```ts
const provider = new FastProvider({ rpcUrl: 'https://api.fast.xyz/proxy' });
```

**After (v2.0):**
```ts
const provider = new FastProvider({ url: 'https://api.fast.xyz/proxy-rest' });
```

**Faucet API removed**: `faucetDrip()` method and faucet error classes are no longer available.

**Error classes replaced**:

```diff
  import {
-   JsonRpcProtocolError,  // removed (no longer applicable)
-   RpcError,              // removed → use RestError
-   RpcTimeoutError,       // deprecated alias → use RestTimeoutError
+   RestError,
+   RestTimeoutError,
+   NotFoundError,
+   IpRateLimitedError,
  } from "@fastxyz/sdk";
```

| v1.x | v2.0 | Status |
|---|---|---|
| `JsonRpcProtocolError` | — | Removed |
| `RpcError` | `RestError` | Replaced |
| `RpcTimeoutError` | `RestTimeoutError` | Deprecated alias (will be removed) |

### New Features

- **Escrow support**: `provider.getEscrowJob()` and `provider.getEscrowJobs()`
- **Version-aware building**: `new TransactionBuilder({ ..., version: 'Release20260319' })` to build old-format transactions
- **`addEscrow()`**: New builder method for escrow operations

### Using the Old Transaction Format

```ts
const builder = new TransactionBuilder({
  networkId: 'fast:mainnet',
  signer,
  nonce,
  version: 'Release20260319', // Explicitly use old format
});
builder.addBurn({ tokenId, amount });
const envelope = await builder.sign();
// Produces: { claim: { Burn: { ... } } }
```

### Network Version Compatibility

| Network Version | Schema | SDK | Default |
|---|---|---|---|
| Release20260319 | `>=1.0.0` | `>=1.0.0` | v1.x default |
| Release20260407 | `>=2.0.0` | `>=2.0.0` | v2.x default |

### Migration Checklist

- Replace `{ rpcUrl: ... }` with `{ url: ... }` in `FastProvider` calls
- Update proxy URLs from `/proxy` to `/proxy-rest`
- Replace `JsonRpcProtocolError` / `RpcError` imports with `RestError`
- Replace `RpcTimeoutError` with `RestTimeoutError`
- Update any raw transaction field access: `.claim` → `.claims[]`

---

## Migrating to v2.1.0

### Breaking Changes

**`ProviderOptions` now requires `networkId`**

`FastProvider` now requires both `url` and `networkId`. Use the built-in `mainnet`/`testnet` constants, or pass `networkId` explicitly.

**Before (v2.0):**
```ts
const provider = new FastProvider({ url: 'https://api.fast.xyz/proxy-rest' });
```

**After (v2.1):**
```ts
import { FastProvider, mainnet } from '@fastxyz/sdk';

const provider = new FastProvider(mainnet); // simplest

// Or explicitly:
const provider = new FastProvider({ url: 'https://api.fast.xyz/proxy-rest', networkId: 'fast:mainnet' });
```

### New Features

- **`mainnet` / `testnet` constants**: built-in `FastNetwork` objects with correct `url`, `networkId`, and `explorerUrl`.
- **`FastNetwork` type**: define custom networks with the same shape.

### Migration Checklist

- Pass `networkId` (or use `mainnet`/`testnet`) in all `FastProvider` calls
