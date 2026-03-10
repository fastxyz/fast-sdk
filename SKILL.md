---
name: fast-sdk
description: >
  Fast SDK for AI agents and Node.js apps. Use @fastxyz/sdk to create or load a Fast wallet,
  check balances, send FAST tokens, sign or verify messages, list held tokens, look up token metadata,
  submit low-level claims, and export wallet info.
  Trigger this skill when a user wants to integrate Fast payments or wallet actions in code,
  or when asked to send funds, inspect balances, sign or verify data, or query Fast token holdings.
  Do NOT use for swaps, bridges, AllSet flows, lending, staking, or generic EVM SDK work.
metadata:
  short-description: Use @fastxyz/sdk for Fast wallet, balance, transfer, token, and signing workflows.
  compatibility: Node.js 20+, npm, network access for Fast RPC, and filesystem access to ~/.fast or FAST_CONFIG_DIR.
---

# Fast SDK

Use `@fastxyz/sdk` for Fast wallet operations in Node.js or TypeScript.

## Install

```bash
npm install @fastxyz/sdk
```

If `npm install @fastxyz/sdk` fails due to a registry or auth issue, use the repo as the source of truth and wire it into the target project from a local checkout or git dependency.

---

## Architecture

The SDK uses **Provider/Wallet separation**:

| Component | Purpose | Private Key? |
|-----------|---------|--------------|
| **FastProvider** | Read-only connection to Fast network | ❌ Not needed |
| **FastWallet** | Sign and send transactions | ✅ Required |

**Rule:** Always create a Provider first, then create a Wallet with that Provider.

---

## FastProvider Setup

### Option 1: Default (testnet)

```ts
import { FastProvider } from '@fastxyz/sdk';

const provider = new FastProvider();
// Uses: network='testnet', RPC from networks.json, explorer from networks.json
```

### Option 2: Specify network

```ts
const provider = new FastProvider({ network: 'testnet' });
// or
const provider = new FastProvider({ network: 'mainnet' });
```

**Where do `testnet` and `mainnet` configs come from?**

The SDK loads network configuration from JSON files in this priority order:

```
1. ~/.fast/networks.json        ← User overrides (highest priority)
2. src/data/networks.json       ← Bundled defaults (ships with package)
3. Hardcoded fallbacks          ← Last resort if JSON fails to load
```

**Bundled defaults** (`src/data/networks.json`):
```json
{
  "testnet": {
    "rpc": "https://staging.proxy.fastset.xyz",
    "explorer": "https://explorer.fast.xyz"
  },
  "mainnet": {
    "rpc": "https://api.fast.xyz/proxy",
    "explorer": "https://explorer.fast.xyz"
  }
}
```

If you need to override these, create `~/.fast/networks.json` with your values — they will take precedence.

### Option 3: Custom RPC URL

```ts
const provider = new FastProvider({
  rpcUrl: 'https://my-custom-rpc.example.com/proxy',
  explorerUrl: 'https://my-custom-explorer.example.com'  // Optional
});
```

**Notes:**
- `explorerUrl` is optional. If not provided, `getExplorerUrl()` returns `null`.
- If both `network` and `rpcUrl` are provided, `rpcUrl` takes effect (network config is ignored).

```ts
// Without explorerUrl - getExplorerUrl() returns null
const provider = new FastProvider({
  rpcUrl: 'https://my-custom-rpc.example.com/proxy'
});
const url = await provider.getExplorerUrl(txHash);  // → null
```

### All ProviderOptions

```ts
interface ProviderOptions {
  network?: 'testnet' | 'mainnet';  // Default: 'testnet'
  rpcUrl?: string;                   // Overrides network RPC
  explorerUrl?: string;              // Overrides network explorer (null if not set)
}
```

---

## FastWallet Setup

**Important:** You must have a FastProvider before creating a FastWallet.

### Option 1: From keyfile path

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });

// Simple: pass path directly
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

// With options: use object form
const wallet = await FastWallet.fromKeyfile({ 
  keyFile: '~/.fast/keys/default.json',
  createIfMissing: false  // Optional, default: true
}, provider);
```

**Notes:**
- If file doesn't exist and `createIfMissing: true` (default): generates new key, saves to file, returns wallet
- If file doesn't exist and `createIfMissing: false`: throws `KEYFILE_NOT_FOUND` error
- If file exists: loads key from file, returns wallet

### Option 2: From keyfile with named key

```ts
const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile({ key: 'merchant' }, provider);
// Resolves to: ~/.fast/keys/merchant.json
// Auto-creates if missing (unless createIfMissing: false)
```

### Option 3: From private key (hex string)

```ts
const provider = new FastProvider({ network: 'testnet' });
const privateKey = 'a919e405ec3c4f8fdfcd892c434043ccf97742432e7cf686530e17fd842f74e3';
const wallet = await FastWallet.fromPrivateKey(privateKey, provider);
// Does NOT save to disk - wallet exists only in memory
// Use saveToKeyfile() to persist if needed
```

### Option 4: Generate new random wallet

```ts
const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.generate(provider);
console.log('New address:', wallet.address);
// Does NOT save to disk - wallet exists only in memory

// To persist:
await wallet.saveToKeyfile('~/.fast/keys/new-wallet.json');
```

### All WalletKeyfileOptions

```ts
interface WalletKeyfileOptions {
  keyFile?: string;          // Explicit path (expands ~)
  key?: string;              // Named key → ~/.fast/keys/{key}.json
  createIfMissing?: boolean; // Default: true. Set false to require existing file.
}
```

### Wallet Creation Summary

| Method | Source | Auto-save? | Use case |
|--------|--------|------------|----------|
| `fromKeyfile(path, provider)` | File or generate | ✅ Yes | Most common |
| `fromKeyfile({ key: 'name' }, provider)` | Named file | ✅ Yes | Multiple wallets |
| `fromKeyfile({ ..., createIfMissing: false }, provider)` | File only | N/A | Must exist |
| `fromPrivateKey(hex, provider)` | Memory | ❌ No | Import existing key |
| `generate(provider)` + `saveToKeyfile()` | Random | ❌ Manual | Create new wallet |

---

## Multiple Wallets, One Provider

```ts
const provider = new FastProvider({ network: 'testnet' });

// All wallets share the same RPC connection
const merchant = await FastWallet.fromKeyfile({ key: 'merchant' }, provider);
const buyer = await FastWallet.fromKeyfile({ key: 'buyer' }, provider);
const treasury = await FastWallet.fromKeyfile({ key: 'treasury' }, provider);

// Files created:
// ~/.fast/keys/merchant.json
// ~/.fast/keys/buyer.json
// ~/.fast/keys/treasury.json
```

---

## Complete Examples

### Example 1: Check balance (read-only, no wallet)

```ts
import { FastProvider } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });
const balance = await provider.getBalance('fast1abc123...', 'FAST');
console.log(`Balance: ${balance.amount} ${balance.token}`);
```

### Example 2: Send tokens

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

const result = await wallet.send({
  to: 'fast1recipient...',
  amount: '10.5',
  token: 'fastUSDC'
});

console.log('TX Hash:', result.txHash);
if (result.explorerUrl) {
  console.log('Explorer:', result.explorerUrl);
}
```

**How does the SDK resolve the `token` parameter?**

The SDK checks the `token` value in this order:

```
1. Is it 'FAST'?        → Use native FAST token (decimals: 9)
2. Is it a hex (0x...)? → Use as token ID directly (query network for decimals)
3. Is it a symbol?      → Look up in tokens.json config
```

**Option A: Use token symbol** (convenient for known tokens)

```ts
await wallet.send({ to, amount: '10', token: 'fastUSDC' });
```

Symbols are resolved from tokens.json in this priority:
```
1. ~/.fast/tokens.json          ← User overrides (highest priority)
2. src/data/tokens.json         ← Bundled defaults (ships with package)
3. Hardcoded fallbacks          ← Last resort
```

**Option B: Use hex token ID** (works for ANY token on the network)

```ts
await wallet.send({ 
  to, 
  amount: '10', 
  token: '0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5' 
});
```

When using hex token ID:
- No tokens.json lookup needed
- SDK queries the network for token decimals via RPC
- Works for any token deployed on the Fast network

**Bundled defaults** (`src/data/tokens.json`):
```json
{
  "FAST": {
    "symbol": "FAST",
    "tokenId": "native",
    "decimals": 9
  },
  "fastUSDC": {
    "symbol": "fastUSDC",
    "tokenId": "0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5",
    "decimals": 6
  }
}
```

**To add custom token symbols**, create `~/.fast/tokens.json`:
```json
{
  "MYTOKEN": {
    "symbol": "MYTOKEN",
    "tokenId": "0x1234567890abcdef...",
    "decimals": 18
  }
}
```

This lets you use `token: 'MYTOKEN'` instead of the full hex ID.

### Example 3: Sign and verify message

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

// Sign
const signed = await wallet.sign({ message: 'Hello, Fast!' });
console.log('Signature:', signed.signature);
console.log('Signer:', signed.address);

// Verify
const verified = await wallet.verify({
  message: 'Hello, Fast!',
  signature: signed.signature,
  address: signed.address
});
console.log('Valid:', verified.valid);
```

### Example 4: List all tokens

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

const tokens = await wallet.tokens();
for (const token of tokens) {
  console.log(`${token.symbol}: ${token.balance} (${token.decimals} decimals)`);
}
```

---

## FastProvider Methods Reference

| Method | Description | Returns |
|--------|-------------|---------|
| `getBalance(address, token?)` | Get balance for any address | `{ amount, token }` |
| `getTokens(address)` | List all token balances | `TokenBalance[]` |
| `getTokenInfo(token)` | Get token metadata | `TokenInfo \| null` |
| `getAccountInfo(address)` | Raw account info from RPC | `object \| null` |
| `getExplorerUrl(txHash?)` | Get explorer URL | `string \| null` |

## FastWallet Methods Reference

| Method | Description | Returns |
|--------|-------------|---------|
| `balance(token?)` | Get wallet balance | `{ amount, token }` |
| `tokens()` | List all token balances | `TokenBalance[]` |
| `send({ to, amount, token? })` | Send tokens | `{ txHash, explorerUrl }` |
| `sign({ message })` | Sign a message | `{ signature, address }` |
| `verify({ message, signature, address })` | Verify signature | `{ valid }` |
| `submit({ recipient, claim })` | Low-level claim submission | `{ txHash, certificate }` |
| `exportKeys()` | Export public key + address | `{ publicKey, address }` |
| `saveToKeyfile(path)` | Save in-memory wallet to disk | `void` |

## FastWallet Properties

| Property | Description |
|----------|-------------|
| `address` | The wallet's Fast address (fast1...) |
| `provider` | The FastProvider this wallet uses |

---

## Error Handling

```ts
import { FastProvider, FastWallet, FastError } from '@fastxyz/sdk';

try {
  const provider = new FastProvider({ network: 'testnet' });
  const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
  await wallet.send({ to: 'fast1...', amount: '100' });
} catch (err) {
  if (err instanceof FastError) {
    console.error('Error code:', err.code);
    console.error('Message:', err.message);
    console.error('Hint:', err.note);
  } else {
    throw err;
  }
}
```

### Error Codes

| Code | Meaning | Common Cause |
|------|---------|--------------|
| `INSUFFICIENT_BALANCE` | Not enough funds | Wallet balance too low |
| `INVALID_ADDRESS` | Bad address format | Not a valid fast1... address |
| `TOKEN_NOT_FOUND` | Unknown token | Token symbol not in config |
| `TX_FAILED` | Transaction rejected | Network error, nonce conflict |
| `KEYFILE_NOT_FOUND` | File doesn't exist | Used createIfMissing: false |
| `INVALID_PARAMS` | Bad parameters | Wrong type or format |
| `UNSUPPORTED_OPERATION` | Not supported | e.g., saveToKeyfile on loaded wallet |

---

## Configuration Files

### Directory Structure

```
~/.fast/
├── keys/
│   ├── default.json      # Default wallet
│   ├── merchant.json     # Named wallet
│   └── buyer.json        # Named wallet
├── networks.json         # Optional: custom networks
└── tokens.json           # Optional: custom tokens
```

### Override config directory

```bash
export FAST_CONFIG_DIR=/custom/path
```

### Custom networks.json

```json
{
  "devnet": {
    "rpc": "http://localhost:8080/proxy",
    "explorer": "http://localhost:3000"
  },
  "private-net": {
    "rpc": "https://private.rpc.example.com/proxy"
  }
}
```

Note: `explorer` is optional. If omitted, `getExplorerUrl()` returns `null`.

### Custom tokens.json

```json
{
  "MYTOKEN": {
    "symbol": "MYTOKEN",
    "tokenId": "0x1234567890abcdef...",
    "decimals": 18
  }
}
```

---

## Security Rules

1. **Never log private keys** — Use `exportKeys()` which only returns public key + address
2. **Don't delete keyfiles** — Use `trash` instead of `rm` if cleanup needed
3. **Handle errors properly** — Catch `FastError` to avoid exposing sensitive details
4. **Use named keys** — Easier to manage than hardcoded paths

---

## Not for This Skill

Do NOT use this SDK for:

- AllSet bridge flows (Fast ↔ EVM)
- Token swaps or routing
- Staking, lending, or yield strategies
- Generic EVM wallet operations
- Cross-chain transactions
