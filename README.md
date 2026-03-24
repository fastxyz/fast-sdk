# Fast SDK

Official TypeScript SDK for the [Fast network](https://fast.xyz).

| Entrypoint | Use Case |
|------------|----------|
| `@fastxyz/sdk` | Node.js apps, keyfile wallets, CLI tools |
| `@fastxyz/sdk/browser` | Browser apps, extensions (no filesystem) |
| `@fastxyz/sdk/core` | Pure helpers only (address encoding, BCS) |

## Install

```bash
npm install @fastxyz/sdk
```

## Quick Start

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

// 1. Create provider
const provider = new FastProvider({ network: 'testnet' });

// 2. Create wallet
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

// 3. Send tokens
const result = await wallet.send({
  to: 'fast1recipient...',
  amount: '1.5',
  token: 'testUSDC'
});

console.log('TX:', result.txHash);
console.log('Explorer:', result.explorerUrl);
```

---

## Provider Setup

Provider is the connection to the Fast network. **Always create a provider first.**

### Default (testnet)

```ts
import { FastProvider } from '@fastxyz/sdk';

const provider = new FastProvider();
// Uses testnet RPC and explorer from bundled config
```

### Specify Network

```ts
const provider = new FastProvider({ network: 'testnet' });
// or
const provider = new FastProvider({ network: 'mainnet' });
```

### Custom RPC

```ts
const provider = new FastProvider({
  rpcUrl: 'https://custom.rpc.example.com/proxy',
  explorerUrl: 'https://custom.explorer.example.com'  // optional
});
```

### Provider Options

```ts
interface ProviderOptions {
  network?: string;       // 'testnet' | 'mainnet' | custom name
  rpcUrl?: string;        // Override network RPC
  explorerUrl?: string;   // Override network explorer
  networks?: Record<string, { rpc: string; explorer?: string }>;
  tokens?: Record<string, { symbol: string; tokenId: string; decimals: number }>;
}
```

---

## Wallet Setup

Wallet is required for signing and sending. **Requires a provider.**

### From Keyfile (recommended)

```ts
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
// Creates file if missing, loads if exists
```

With options:

```ts
const wallet = await FastWallet.fromKeyfile({
  keyFile: '~/.fast/keys/default.json',
  createIfMissing: false  // Throw if file doesn't exist
}, provider);
```

### Named Keys

```ts
const wallet = await FastWallet.fromKeyfile({ key: 'merchant' }, provider);
// Resolves to: ~/.fast/keys/merchant.json
```

### From Private Key

```ts
const privateKey = 'a919e405ec3c4f8f...'; // 64 hex chars
const wallet = await FastWallet.fromPrivateKey(privateKey, provider);
// In-memory only, not saved to disk
```

### Generate New Wallet

```ts
const wallet = await FastWallet.generate(provider);
console.log('Address:', wallet.address);

// Save to disk
await wallet.saveToKeyfile('~/.fast/keys/new.json');
```

### Wallet Creation Summary

| Method | Auto-save? | Use Case |
|--------|------------|----------|
| `fromKeyfile(path, provider)` | ✅ Yes | Most common |
| `fromKeyfile({ key: 'name' }, provider)` | ✅ Yes | Named wallets |
| `fromPrivateKey(hex, provider)` | ❌ No | Import existing |
| `generate(provider)` | ❌ No | Create new |

---

## Common Operations

### Check Balance (read-only, no wallet needed)

```ts
const balance = await provider.getBalance('fast1abc...', 'FAST');
console.log(`${balance.amount} ${balance.token}`);
```

### Send Tokens

```ts
const result = await wallet.send({
  to: 'fast1recipient...',
  amount: '10.5',
  token: 'testUSDC'  // or 'FAST' or hex token ID
});

console.log('TX Hash:', result.txHash);
console.log('Certificate:', result.certificate);
console.log('Explorer:', result.explorerUrl);
```

### Sign Message

```ts
const signed = await wallet.sign({ message: 'Hello, Fast!' });
console.log('Signature:', signed.signature);
console.log('Signer:', signed.address);
```

### Verify Signature

```ts
const verified = await wallet.verify({
  message: 'Hello, Fast!',
  signature: signed.signature,
  address: signed.address
});
console.log('Valid:', verified.valid);
```

### List All Tokens

```ts
const tokens = await wallet.tokens();
for (const t of tokens) {
  console.log(`${t.symbol}: ${t.balance}`);
}
```

### Export Wallet Info

```ts
const info = wallet.exportKeys();
console.log('Address:', info.address);
console.log('Public Key:', info.publicKey);
// Note: privateKey is never exported
```

---

## Configuration

### Token Resolution

The `token` parameter resolves in this order:

1. `'FAST'` → Native FAST token
2. `'0x...'` → Hex token ID (queries network for decimals)
3. `'testUSDC'` → Symbol lookup from config

**Bundled token symbols:**
- `testnet`: `FAST`, `testUSDC`
- `mainnet`: `FAST`, `fastUSDC`

### Config Files

```
~/.fast/
├── keys/
│   ├── default.json
│   └── merchant.json
├── networks.json    # Optional: custom networks
└── tokens.json      # Optional: custom tokens
```

**Config precedence:**
1. Constructor overrides (highest)
2. `~/.fast/*.json` user files
3. Bundled defaults
4. Hardcoded fallbacks

### Custom Network

Create `~/.fast/networks.json`:

```json
{
  "devnet": {
    "rpc": "http://localhost:8080/proxy",
    "explorer": "http://localhost:3000"
  }
}
```

Then use: `new FastProvider({ network: 'devnet' })`

### Custom Token

Create `~/.fast/tokens.json`:

```json
{
  "testnet": {
    "MYTOKEN": {
      "symbol": "MYTOKEN",
      "tokenId": "0x1234...",
      "decimals": 18
    }
  }
}
```

Then use: `wallet.send({ to, amount: '10', token: 'MYTOKEN' })`

### Override Config Directory

```bash
export FAST_CONFIG_DIR=/custom/path
```

---

## Browser Usage

Use `@fastxyz/sdk/browser` for browser apps:

```ts
import { FastProvider, getCertificateHash } from '@fastxyz/sdk/browser';

const provider = new FastProvider({ network: 'testnet' });
const balance = await provider.getBalance('fast1...', 'FAST');
```

**Browser limitations:**
- No `FastWallet` (no filesystem access)
- No `~/.fast/*` config loading
- Use constructor overrides for custom config

**Available in browser:**
- `FastProvider` (read-only operations)
- Address helpers: `encodeFastAddress`, `decodeFastAddress`, `fastAddressToBytes`
- Certificate helpers: `getCertificateHash`, `getCertificateTransaction`
- Config helpers: `getNetworkInfo`, `getDefaultRpcUrl`, `getExplorerUrl`

For wallet signing in browsers, use an injected wallet or build on `fast-connector`.

---

## API Reference

### FastProvider Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getBalance(address, token?)` | Get balance | `{ amount, token }` |
| `getTokens(address)` | List all balances | `TokenBalance[]` |
| `getTokenInfo(token)` | Token metadata | `TokenInfo \| null` |
| `getAccountInfo(address)` | Raw account info | `object \| null` |
| `getCertificateByNonce(address, nonce)` | Fetch certificate | `Certificate \| null` |
| `getExplorerUrl(txHash?)` | Explorer URL | `string \| null` |
| `submitTransaction(envelope)` | Raw submit | `SubmitResult` |
| `faucetDrip({ recipient, amount, token? })` | Testnet faucet | `void` |

### FastWallet Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `balance(token?)` | Wallet balance | `{ amount, token }` |
| `tokens()` | All balances | `TokenBalance[]` |
| `send({ to, amount, token? })` | Send tokens | `{ txHash, certificate, explorerUrl }` |
| `sign({ message })` | Sign message | `{ signature, address, messageBytes }` |
| `verify({ message, signature, address })` | Verify | `{ valid }` |
| `exportKeys()` | Export public info | `{ publicKey, address }` |
| `saveToKeyfile(path)` | Save to disk | `void` |

### Error Codes

| Code | Meaning |
|------|---------|
| `INSUFFICIENT_BALANCE` | Not enough funds |
| `INVALID_ADDRESS` | Bad fast1... address |
| `TOKEN_NOT_FOUND` | Unknown token symbol |
| `TX_FAILED` | Transaction rejected |
| `KEYFILE_NOT_FOUND` | File doesn't exist (createIfMissing: false) |
| `INVALID_PARAMS` | Wrong parameter type/format |

```ts
import { FastError } from '@fastxyz/sdk';

try {
  await wallet.send({ to, amount: '100' });
} catch (err) {
  if (err instanceof FastError) {
    console.error(err.code, err.message, err.note);
  }
}
```

---

## Development

```bash
npm install
npm run build
npm test
npm run live:smoke -- --live  # Real network test
```

See [RELEASING.md](./RELEASING.md) for release process.
