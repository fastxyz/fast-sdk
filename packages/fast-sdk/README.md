# @fastxyz/fast-sdk

TypeScript SDK for the Fast network. Provides a high-level API for signing
transactions, querying the network, and converting addresses and amounts.

## Install

```bash
npm install @fastxyz/fast-sdk
```

## Quick start

```ts
import { FastProvider, Signer, TransactionBuilder } from "@fastxyz/fast-sdk";

// Create a signer from a 32-byte hex private key
const signer = new Signer("0xabcdef0123456789...");
const pubKey = await signer.getPublicKey();

// Connect to a proxy RPC endpoint
const provider = new FastProvider({ rpcUrl: "https://api.fast.xyz/proxy" });

// Fetch account info
const account = await provider.getAccountInfo({
  address: pubKey
});

// Build and sign a transaction
const envelope = await new TransactionBuilder({
  networkId: "fast:mainnet",
  signer,
  nonce: account.nextNonce,
})
  .addBurn({ tokenId: "11".repeat(32), amount: 100n })
  .sign();

// Submit
const result = await provider.submitTransaction(envelope);
```

## API overview

### Signer

Ed25519 signer that accepts private keys as hex strings, `Uint8Array`, or `number[]`.

```ts
const signer = new Signer(privateKey);
const pubKey = await signer.getPublicKey();            // 32-byte Ed25519 public key
const address = await signer.getFastAddress();         // "fast1..."
const sig = await signer.signMessage(message);         // 64-byte signature
const sig = await signer.signTypedData(bcsType, data); // BCS domain-prefixed
```

Standalone verification:

```ts
import { verify, verifyTypedData } from "@fastxyz/fast-sdk";
const valid = await verify(signature, message, publicKey);
```

### FastProvider

Typed JSON-RPC client for the Fast proxy API.

| Method                                   | Description                                 |
| ---------------------------------------- | ------------------------------------------- |
| `submitTransaction(envelope)`            | Submit a signed transaction                 |
| `getAccountInfo(params)`                 | Fetch balance, nonce, token balances, state |
| `getTokenInfo(params)`                   | Fetch token metadata                        |
| `getTransactionCertificates(params)`     | Fetch finalized certificates                |
| `getPendingMultisigTransactions(params)` | Fetch pending multisig txs                  |
| `faucetDrip(params)`                     | Request testnet/devnet faucet drip          |

### TransactionBuilder

Fluent builder for all 12 operation types. Single operations produce a direct
claim type; multiple operations are automatically batched.

```ts
const builder = new TransactionBuilder({ networkId, signer, nonce });

builder
  .addTokenTransfer({ tokenId, recipient, amount: 1000n, userData: null })
  .addBurn({ tokenId, amount: 500n });

const envelope = await builder.sign(); // Batch of 2 operations
```

Supported operations: `addTokenTransfer`, `addTokenCreation`,
`addTokenManagement`, `addMint`, `addBurn`,
`addStateInitialization`, `addStateUpdate`, `addStateReset`,
`addExternalClaim`, `addLeaveCommittee`.

### Conversion utilities

```ts
import { toHex, fromHex, toFastAddress, fromFastAddress } from "@fastxyz/fast-sdk";

toHex(bytes);              // "0x..."
fromHex("0xabcd");         // Uint8Array
toFastAddress(pubKey);     // "fast1..."
fromFastAddress("fast1..."); // Uint8Array
```

### BCS encoding

```ts
import { encode, hash, hashHex, getTokenId } from "@fastxyz/fast-sdk";

const bytes = await encode(bcsSchema, data);
const h = await hashHex(bcsSchema, data);       // "0x..." keccak-256
const tokenId = getTokenId(sender, nonce, 0n);  // deterministic token ID
```

### Error handling

All errors are typed and can be matched with `instanceof`:

```ts
import { UnexpectedNonceError, InsufficientFundingError } from "@fastxyz/fast-sdk";

try {
  await provider.submitTransaction(envelope);
} catch (e) {
  if (e instanceof UnexpectedNonceError) {
    console.log("Expected nonce:", e.expectedNonce);
  }
}
```

Error hierarchy: Network → JSON-RPC Protocol → Proxy → Validator (FastSet).

## Development

```bash
pnpm build    # Build with tsup
pnpm test     # Run tests (from repo root: pnpm vitest run)
```
