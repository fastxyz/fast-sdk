---
name: fast-sdk
description: >
  Fast SDK for AI agents, Node.js apps, and browser apps. Create wallets, check balances,
  send tokens, sign messages, and query the Fast network. Use @fastxyz/sdk for Node.js,
  @fastxyz/sdk/browser for browsers, @fastxyz/sdk/core for pure helpers.
metadata:
  short-description: Fast wallet, balance, transfer, and signing workflows.
  compatibility: Node.js 20+ for @fastxyz/sdk; browsers for @fastxyz/sdk/browser.
---

# Fast SDK Skill

## When to Use This Skill

**USE this skill when the user wants to:**
- Check Fast network balances
- Send FAST or USDC tokens on Fast
- Create or load a Fast wallet
- Sign or verify messages with a Fast address
- List tokens held by a Fast address
- Query Fast certificates or transactions

**DO NOT use this skill for:**
- AllSet bridge flows (Fast ↔ EVM) → use [`allset-sdk`](https://github.com/fastxyz/allset-sdk)
- Token swaps or DEX operations
- Staking, lending, or yield strategies
- Generic EVM wallet operations
- Cross-chain transactions

---

## Decision Tree: Which Entrypoint?

```
Is this a Node.js app or agent?
├── YES → Use @fastxyz/sdk
│         (Full wallet support, keyfiles, filesystem config)
│
└── NO → Is this a browser app?
         ├── YES → Use @fastxyz/sdk/browser
         │         (Provider only, no wallet, no filesystem)
         │
         └── NO → Use @fastxyz/sdk/core
                  (Pure helpers: address encoding, BCS, types)
```

**Default choice:** `@fastxyz/sdk` (Node.js) — covers most agent use cases.

---

## Workflows

### 1. Setup Provider

**When:** Always. Provider is required for all operations.

**Prerequisites:** None.

**Steps:**

1. Import FastProvider:
   ```ts
   import { FastProvider } from '@fastxyz/sdk';
   ```

2. Choose network option:

   **Option A: Default testnet**
   ```ts
   const provider = new FastProvider();
   ```

   **Option B: Specify network**
   ```ts
   const provider = new FastProvider({ network: 'testnet' });
   // or
   const provider = new FastProvider({ network: 'mainnet' });
   ```

   **Option C: Custom RPC**
   ```ts
   const provider = new FastProvider({
     rpcUrl: 'https://custom.rpc.example.com/proxy',
     explorerUrl: 'https://custom.explorer.example.com'  // optional
   });
   ```

3. Provider is ready. Use for provider operations directly, or pass it to a wallet for signing flows.

**Network name resolution order:**
1. Constructor `networks` override (highest priority)
2. `~/.fast/networks.json` (user config)
3. Bundled `src/config/data/networks.json`
4. Hardcoded fallbacks (`testnet`, `mainnet`)

---

### 2. Setup Wallet

**When:** Need to sign transactions or messages.

**Prerequisites:** Provider must exist.

**Steps:**

1. Decide which wallet method to use:

   ```
   Do you have a keyfile path?
   ├── YES → Use fromKeyfile(path, provider)
   │
   └── NO → Do you have a private key string?
            ├── YES → Use fromPrivateKey(key, provider)
            │
            └── NO → Do you need a new wallet?
                     ├── YES → Use generate(provider)
                     └── NO → Use fromKeyfile({ key: 'name' }, provider)
   ```

2. Create wallet:

   **Option A: From keyfile (most common)**
   ```ts
   import { FastWallet } from '@fastxyz/sdk';
   
   const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
   // Creates file if missing, loads if exists
   ```

   **Option B: Named key**
   ```ts
   const wallet = await FastWallet.fromKeyfile({ key: 'merchant' }, provider);
   // Uses ~/.fast/keys/merchant.json
   ```

   **Wallet keyfile resolution order:**
   1. Explicit `keyFile` path (if provided, highest priority)
   2. Named `key` → `~/.fast/keys/{key}.json`
   3. Default → `~/.fast/keys/default.json`
   
   Base directory: `~/.fast/` (override with `FAST_CONFIG_DIR` env var)

   **Option C: From private key (in-memory)**
   ```ts
   const wallet = await FastWallet.fromPrivateKey(privateKeyHex, provider);
   // Does NOT save to disk
   ```

   **Option D: Generate new**
   ```ts
   const wallet = await FastWallet.generate(provider);
   // Save if needed:
   await wallet.saveToKeyfile('~/.fast/keys/new.json');
   ```

3. Wallet is ready. Access address via `wallet.address`.

---

### 3. Check Balance

**When:** User asks for balance of any Fast address.

**Prerequisites:** Provider only (no wallet needed for other addresses).

**Steps:**

1. For any address (read-only):
   ```ts
   const balance = await provider.getBalance('fast1abc...', 'FAST');
   // or with token symbol
   const balance = await provider.getBalance('fast1abc...', 'testUSDC');
   ```

2. For wallet's own balance:
   ```ts
   const balance = await wallet.balance('FAST');
   ```

3. Return result:
   ```ts
   console.log(`${balance.amount} ${balance.token}`);
   ```

**Token parameter options:**
- `'FAST'` → Native token
- `'testUSDC'` (testnet) / `'USDC'` (mainnet) → USDC tokens
- `'0x...'` → Any token by hex ID

---

### 4. Send Tokens

**When:** User wants to transfer tokens to another Fast address.

**Prerequisites:** Provider + Wallet.

**Steps:**

1. Ensure wallet is set up (see Workflow 2).

2. Call send:
   ```ts
   const result = await wallet.send({
     to: 'fast1recipient...',
     amount: '10.5',           // Human-readable amount
     token: 'testUSDC'         // Optional, defaults to 'FAST'
   });
   ```

3. Return result to user:
   ```ts
   console.log('TX Hash:', result.txHash);
   console.log('Explorer:', result.explorerUrl);
   ```

4. Handle errors:
   ```ts
   import { FastError } from '@fastxyz/sdk';
   
   try {
     const result = await wallet.send({ to, amount, token });
   } catch (err) {
     if (err instanceof FastError) {
       if (err.code === 'INSUFFICIENT_BALANCE') {
         // Tell user they don't have enough funds
       } else if (err.code === 'INVALID_ADDRESS') {
         // Tell user the recipient address is invalid
       }
     }
   }
   ```

---

### 5. Sign Message

**When:** User wants to sign arbitrary data with their Fast address.

**Prerequisites:** Provider + Wallet.

**Steps:**

1. Call sign:
   ```ts
   const signed = await wallet.sign({ message: 'Hello, Fast!' });
   ```

2. Return result:
   ```ts
   console.log('Signature:', signed.signature);
   console.log('Signer:', signed.address);
   console.log('Message bytes:', signed.messageBytes);
   ```

---

### 6. Verify Signature

**When:** User wants to verify a signature was made by a specific Fast address.

**Prerequisites:** Provider + Wallet (any wallet, verification uses public data).

**Steps:**

1. Call verify:
   ```ts
   const result = await wallet.verify({
     message: 'Hello, Fast!',
     signature: '0xabc123...',
     address: 'fast1signer...'
   });
   ```

2. Return result:
   ```ts
   console.log('Valid:', result.valid);  // true or false
   ```

---

### 7. List All Tokens

**When:** User wants to see all tokens held by a wallet.

**Prerequisites:** Provider + Wallet.

**Steps:**

1. Call tokens:
   ```ts
   const tokens = await wallet.tokens();
   ```

2. Format and return:
   ```ts
   for (const t of tokens) {
     console.log(`${t.symbol}: ${t.balance} (${t.decimals} decimals)`);
   }
   ```

---

---

## Token Resolution Rules

When user specifies a token, resolve in this order:

```
Is token === 'FAST'?
├── YES → Use native FAST token (decimals: 18)
│
└── NO → Does token start with '0x'?
         ├── YES → Use as hex token ID, query network for decimals
         │
         └── NO → Look up symbol in tokens.json config
                  ├── FOUND → Use configured tokenId and decimals
                  └── NOT FOUND → Throw TOKEN_NOT_FOUND error
```

**Bundled symbols by network:**
- `testnet`: `FAST`, `testUSDC`
- `mainnet`: `FAST`, `USDC`

---

## Error Handling

| Error Code | Meaning | Agent Response |
|------------|---------|----------------|
| `INSUFFICIENT_BALANCE` | Not enough funds | Tell user their balance is too low |
| `INVALID_ADDRESS` | Bad fast... format | Ask user to check the address |
| `TOKEN_NOT_FOUND` | Unknown symbol | Ask user for hex token ID or check spelling |
| `TX_FAILED` | Network rejected tx | Wait and retry, or report network issue |
| `KEYFILE_NOT_FOUND` | File missing | Create wallet or check path |
| `INVALID_PARAMS` | Wrong parameter type | Check parameter format |

**Error handling pattern:**
```ts
import { FastError } from '@fastxyz/sdk';

try {
  // operation
} catch (err) {
  if (err instanceof FastError) {
    // Use err.code, err.message, err.note
  } else {
    throw err;  // Re-throw unexpected errors
  }
}
```

---

## Common Mistakes (DO NOT)

1. **DO NOT** use this SDK for bridges — use [`@fastxyz/allset-sdk`](https://github.com/fastxyz/allset-sdk)

2. **DO NOT** hardcode explorer URLs — use `provider.getExplorerUrl(txHash)`

3. **DO NOT** log private keys — use `wallet.exportKeys()` for public info only

4. **DO NOT** create wallet before provider:
   ```ts
   // WRONG
   const wallet = await FastWallet.fromKeyfile(path);  // Missing provider!
   
   // CORRECT
   const provider = new FastProvider();
   const wallet = await FastWallet.fromKeyfile(path, provider);
   ```

5. **DO NOT** use wrong token symbols for network:
   ```ts
   // WRONG (USDC symbol is mainnet only, testnet uses testUSDC)
   const provider = new FastProvider({ network: 'testnet' });
   await wallet.send({ to, amount: '10', token: 'USDC' });
   
   // CORRECT
   await wallet.send({ to, amount: '10', token: 'testUSDC' });
   ```

6. **DO NOT** assume wallet methods exist on provider:
   ```ts
   // WRONG
   await provider.send({ to, amount });  // send() is on wallet, not provider
   
   // CORRECT
   await wallet.send({ to, amount });
   ```

---

## Configuration Paths

| Path | Purpose |
|------|---------|
| `~/.fast/keys/` | Wallet keyfiles |
| `~/.fast/keys/default.json` | Default wallet |
| `~/.fast/keys/{name}.json` | Named wallets |
| `~/.fast/networks.json` | Custom network configs |
| `~/.fast/tokens.json` | Custom token symbols |

**Override base directory:**
```bash
export FAST_CONFIG_DIR=/custom/path
```

---

## Quick Reference

### Imports

```ts
// Node.js (full SDK)
import { FastProvider, FastWallet, FastError } from '@fastxyz/sdk';

// Browser (no wallet)
import { FastProvider, getCertificateHash } from '@fastxyz/sdk/browser';

// Pure helpers only
import { encodeFastAddress, decodeFastAddress } from '@fastxyz/sdk/core';
```

### Common Patterns

```ts
// Setup
const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

// Read
const balance = await wallet.balance('FAST');
const tokens = await wallet.tokens();

// Write
const tx = await wallet.send({ to: 'fast...', amount: '1', token: 'testUSDC' });

// Sign
const signed = await wallet.sign({ message: 'Hello' });
const verified = await wallet.verify({ message, signature, address });

// Info
const info = await wallet.exportKeys();  // { publicKey, address }
```
