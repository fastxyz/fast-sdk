---
name: fast-sdk
description: >
  Fast network SDK for AI agents and Node.js apps. Build and sign
  transactions, query accounts, transfer tokens, and manage keys
  using @fastxyz/sdk.
metadata:
  short-description: Fast transaction building, signing, and RPC queries.
  compatibility: Node.js 20+, browsers, workers.
---

# Fast SDK Skill

## When to Use This Skill

**USE this skill when the user wants to:**

- Build and sign Fast network transactions
- Query account balances, nonces, or token metadata
- Transfer tokens on the Fast network
- Create or burn tokens
- Sign or verify messages with an Ed25519 key
- Convert between hex, bytes, and bech32m addresses

**DO NOT use this skill for:**

- Bridge flows (Fast to EVM) — use allset-sdk
- Token swaps or DEX operations
- Generic EVM wallet operations

---

## Core Concepts

The SDK has three main classes:

| Class                | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `Signer`             | Holds an Ed25519 private key, signs messages |
| `FastProvider`       | JSON-RPC client for the Fast proxy API       |
| `TransactionBuilder` | Fluent builder for all transaction types     |

**Typical flow:** Create Signer → Create Provider → Get account
info → Build transaction → Sign → Submit.

---

## Workflows

### 1. Create a Signer

**When:** Need to sign transactions or derive an address.

```ts
import { Signer } from '@fastxyz/sdk';

// From a 32-byte hex private key (0x prefix optional)
const signer = new Signer('abcdef0123456789...');

// Or from raw bytes
const signer = new Signer(new Uint8Array(32));

// Or from a number array
const signer = new Signer([1, 2, 3 /* ...32 bytes */]);
```

**Get address and public key:**

```ts
const pubKey = await signer.getPublicKey(); // Uint8Array (32)
const address = await signer.getFastAddress(); // "fast1..."
```

---

### 2. Connect to the Network

**When:** Need to query or submit transactions.

```ts
import { FastProvider } from '@fastxyz/sdk';

const provider = new FastProvider({
  rpcUrl: 'https://api.fast.xyz/proxy',
});
```

There is no default URL — `rpcUrl` is always required.

---

### 3. Check Account Info

**When:** Need balance, nonce, or token holdings.

```ts
const account = await provider.getAccountInfo({
  address: pubKey, // Uint8Array, hex string, or bech32m
});

console.log('Balance:', account.balance); // bigint
console.log('Next nonce:', account.nextNonce); // bigint
console.log('Tokens:', account.tokenBalance); // [id, amt][]
```

**Optional filters** (all default to null if omitted):

```ts
const account = await provider.getAccountInfo({
  address: pubKey,
  tokenBalancesFilter: [tokenIdBytes],
  stateKeyFilter: [stateKeyBytes],
  certificateByNonce: { start: 0n, limit: 10 },
});
```

---

### 4. Transfer Tokens

**When:** Send tokens to another address.

```ts
import { TransactionBuilder } from '@fastxyz/sdk';

const account = await provider.getAccountInfo({
  address: pubKey,
});

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

---

### 5. Build Other Transaction Types

**When:** Need operations beyond simple transfers.

The `TransactionBuilder` supports 10 operation types via fluent
chaining. Single operations produce a direct claim; multiple
operations are automatically batched.

```ts
const builder = new TransactionBuilder({
  networkId: 'fast:mainnet',
  signer,
  nonce: account.nextNonce,
});

// Token operations
builder.addTokenCreation({
  tokenName,
  decimals,
  initialAmount,
  mints,
  userData,
});
builder.addTokenManagement({
  tokenId,
  updateId,
  newAdmin,
  mints,
  userData,
});
builder.addMint({ tokenId, recipient, amount });
builder.addBurn({ tokenId, amount });

// State operations
builder.addStateInitialization({ key, initialState });
builder.addStateUpdate({
  key,
  previousState,
  nextState,
  computeClaimTxHash,
  computeClaimTxTimestamp,
});
builder.addStateReset({ key, resetState });

// External claims
builder.addExternalClaim({
  claim: { verifierCommittee, verifierQuorum, claimData },
  signatures,
});

// Committee
builder.addLeaveCommittee();

// Batch multiple operations
builder.addBurn({ tokenId, amount: 100n }).addBurn({ tokenId, amount: 200n });

const envelope = await builder.sign();
```

**Builder reuse:** Call `builder.reset()` to clear operations,
then `builder.setNonce(newNonce)` for the next transaction.

---

### 6. Sign and Verify Messages

**When:** Sign arbitrary data or verify signatures.

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

---

### 7. Query Certificates and Token Metadata

```ts
// Get finalized transaction certificates
const certs = await provider.getTransactionCertificates({
  address: pubKey,
  fromNonce: 0n,
  limit: 10,
});

// Get token metadata
const tokenInfo = await provider.getTokenInfo({
  tokenIds: [tokenIdBytes],
});

// Get pending multisig transactions
const pending = await provider.getPendingMultisigTransactions({
  address: pubKey,
});
```

---

### 8. Address and Hex Conversions

```ts
import { toHex, fromHex, toFastAddress, fromFastAddress, bigintToHex, bigintFromHex } from '@fastxyz/sdk';

toHex(bytes); // "0xabcd..."
fromHex('0xabcd'); // Uint8Array
toFastAddress(pubKeyBytes); // "fast1..."
fromFastAddress('fast1...'); // Uint8Array
bigintToHex(255n); // "0xff"
bigintFromHex('0xff'); // 255n
```

---

## Error Handling

Errors are typed and matchable with `instanceof`. They are
organized in 4 layers:

| Layer     | Error Classes                                            | When               |
| --------- | -------------------------------------------------------- | ------------------ |
| Network   | `RpcTimeoutError`                                        | Connection timeout |
| JSON-RPC  | `JsonRpcProtocolError`                                   | Protocol errors    |
| Proxy     | `InvalidRequestError`, `ProxyUnexpectedNonceError`, etc. | Proxy rejects      |
| Validator | `UnexpectedNonceError`, etc.                             | Validator rejects  |

```ts
import { UnexpectedNonceError, InsufficientFundingError } from '@fastxyz/sdk';

try {
  await provider.submitTransaction(envelope);
} catch (e) {
  if (e instanceof UnexpectedNonceError) {
    console.log('Expected:', e.expectedNonce);
  } else if (e instanceof InsufficientFundingError) {
    console.log('Balance:', e.currentBalance);
  }
}
```

---

## Common Mistakes (DO NOT)

1. **DO NOT** pass a wrong-length key to `new Signer()` — it
   must be exactly 32 bytes (64 hex chars, or 66 with `0x`).

2. **DO NOT** skip the nonce — always fetch
   `account.nextNonce` from `getAccountInfo` before building.

3. **DO NOT** forget to call `.sign()` on the builder — it
   returns a Promise, not the envelope directly.

4. **DO NOT** construct `FastProvider` without `rpcUrl` —
   there is no default endpoint.

5. **DO NOT** reuse a builder without calling `.reset()` —
   operations accumulate across calls.

---

## Quick Reference

```ts
import { Signer, FastProvider, TransactionBuilder, verify, toHex, fromHex, toFastAddress, fromFastAddress } from '@fastxyz/sdk';

// Setup
const signer = new Signer(privateKeyHex);
const provider = new FastProvider({
  rpcUrl: 'https://api.fast.xyz/proxy',
});

// Read
const account = await provider.getAccountInfo({
  address: await signer.getPublicKey(),
});

// Write
const envelope = await new TransactionBuilder({
  networkId: 'fast:mainnet',
  signer,
  nonce: account.nextNonce,
})
  .addTokenTransfer({
    tokenId,
    recipient,
    amount: 1000n,
    userData: null,
  })
  .sign();

const result = await provider.submitTransaction(envelope);

// Sign & verify
const sig = await signer.signMessage(msg);
const pubKey = await signer.getPublicKey();
const valid = await verify(sig, msg, pubKey);

// Address
const address = await signer.getFastAddress(); // "fast1..."
```
