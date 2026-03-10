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

Use the local repo when you are already working inside this checkout.

When the package is published, install it into the target project with its existing package manager.

```bash
npm install @fastxyz/sdk
```

If `npm install @fastxyz/sdk` fails due to a registry or auth issue, use this repo as the source of truth and wire it into the target project from a local checkout or git dependency instead of inventing a different package name.

## Architecture

The SDK uses Provider/Wallet separation:

- **FastProvider** — Read-only connection to the Fast network. No private key needed.
- **FastWallet** — Wallet for signing transactions. Requires a provider.

## Default Workflow

1. Import `FastProvider` and `FastWallet` from `@fastxyz/sdk`.
2. Create a provider with `new FastProvider({ network: 'testnet' })`.
3. Create or load a wallet with `FastWallet.fromKeyfile(path, provider)`.
4. Use wallet methods for balance, send, signing, or token operations.
5. Use provider methods for read-only queries without a wallet.

```ts
import { FastProvider, FastWallet } from '@fastxyz/sdk';

const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);

const balance = await wallet.balance();
console.log(balance);
```

### Custom RPC endpoint

```ts
const provider = new FastProvider({
  network: 'testnet',
  rpcUrl: 'https://custom-rpc.example.com/proxy'
});
```

### Multiple wallets

```ts
const provider = new FastProvider({ network: 'testnet' });
const merchant = await FastWallet.fromKeyfile({ key: 'merchant' }, provider);
const buyer = await FastWallet.fromKeyfile({ key: 'buyer' }, provider);

// Both use the same provider (one RPC connection)
```

### Generate new wallet

```ts
const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.generate(provider);
console.log('New address:', wallet.address);

// Save to disk
await wallet.saveToKeyfile('~/.fast/keys/new-wallet.json');
```

### From private key

```ts
const provider = new FastProvider({ network: 'testnet' });
const wallet = await FastWallet.fromPrivateKey('a919e405...', provider);
```

## FastProvider Methods

### Read-only queries (no wallet needed)

```ts
const provider = new FastProvider({ network: 'testnet' });

// Get balance for any address
const balance = await provider.getBalance('fast1...', 'FAST');

// Get all token balances
const tokens = await provider.getTokens('fast1...');

// Get token info
const info = await provider.getTokenInfo('fastUSDC');

// Get explorer URL
const url = await provider.getExplorerUrl(txHash);
```

## FastWallet Methods

### Balance

```ts
const balance = await wallet.balance('FAST');
const usdcBalance = await wallet.balance('fastUSDC');
```

### Send

```ts
const result = await wallet.send({
  to: 'fast1...',
  amount: '10.5',
  token: 'fastUSDC', // optional, defaults to 'FAST'
});
console.log(result.txHash);
console.log(result.explorerUrl);
```

### Sign/Verify

```ts
const signed = await wallet.sign({ message: 'Hello, Fast!' });
console.log(signed.signature);

const verified = await wallet.verify({
  message: 'Hello, Fast!',
  signature: signed.signature,
  address: wallet.address,
});
console.log(verified.valid);
```

### Tokens

```ts
const tokens = await wallet.tokens();
// [{ symbol: 'FAST', tokenId: 'native', balance: '100', decimals: 9 }, ...]
```

### Export Keys

```ts
const keys = await wallet.exportKeys();
console.log(keys.publicKey);
console.log(keys.address);
// Never exposes private key
```

### Submit (low-level)

```ts
const result = await wallet.submit({
  recipient: 'fast1...',
  claim: {
    TokenTransfer: {
      token_id: tokenIdBytes,
      amount: '0x2710',
      user_data: null,
    },
  },
});
```

## Security Rules

- Do not print, rewrite, or delete wallet key files under `~/.fast/keys/`.
- Never log or expose private keys in any output.
- For new wallets, use `FastWallet.generate()` then `saveToKeyfile()`.
- Always handle `FastError` to avoid exposing sensitive details.

## Error Handling

```ts
import { FastWallet, FastProvider, FastError } from '@fastxyz/sdk';

try {
  await wallet.send({ to, amount });
} catch (err) {
  if (err instanceof FastError) {
    console.log('Code:', err.code);
    console.log('Note:', err.note);
  }
}
```

### Error Codes

- `INSUFFICIENT_BALANCE`: not enough funds
- `INVALID_ADDRESS`: bad Fast address format
- `TOKEN_NOT_FOUND`: unknown token symbol or ID
- `TX_FAILED`: transaction rejected
- `KEYFILE_NOT_FOUND`: keyfile doesn't exist (when createIfMissing=false)
- `INVALID_PARAMS`: bad input parameters
- `UNSUPPORTED_OPERATION`: operation not supported

## Local State

- Default config dir: `~/.fast`
- Override config dir: `FAST_CONFIG_DIR`
- Key file: `~/.fast/keys/default.json` (or `~/.fast/keys/{key}.json` for named keys)
- Optional seed env var: `MONEY_FAST_PRIVATE_KEY`

### Configuration Files (Optional)

Network and token configuration is loaded from JSON files. User overrides in `~/.fast/` take precedence over bundled defaults:

- `~/.fast/networks.json` — Custom networks
- `~/.fast/tokens.json` — Custom tokens

Example `~/.fast/networks.json`:
```json
{
  "custom-net": {
    "rpc": "https://custom.rpc.url/proxy",
    "explorer": "https://custom.explorer.url"
  }
}
```

Example `~/.fast/tokens.json`:
```json
{
  "MYTOKEN": {
    "symbol": "MYTOKEN",
    "tokenId": "0x1234...",
    "decimals": 18
  }
}
```

## Not for This Skill

Do not use this SDK for:

- AllSet bridge flows
- swaps or routing
- staking, lending, or yield strategies
- generic EVM wallet operations outside Fast certificate handling
