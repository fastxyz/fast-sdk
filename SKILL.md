---
name: fast-sdk
description: >
  Fast SDK for AI agents and Node.js apps. Use @fastxyz/sdk to create or load a Fast wallet,
  check balances, send SET or Fast tokens, sign or verify messages, list held tokens, look up token metadata,
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

## Default Workflow

1. Import `fast` from `@fastxyz/sdk`.
2. Create the client with `fast({ network: 'testnet' })` unless the user explicitly asked for mainnet.
3. Call `await client.setup()` before any balance, send, signing, or token operation.
4. Use the high-level methods first: `balance`, `send`, `sign`, `verify`, `tokens`, `tokenInfo`, `exportKeys`.
5. Use `submit` only when the user explicitly needs low-level claim handling.

```ts
import { fast } from '@fastxyz/sdk';

const client = fast({ network: 'testnet' });
const { address } = await client.setup();
const balance = await client.balance();
```

### Custom RPC endpoint

```ts
const client = fast({
  network: 'testnet',
  rpcUrl: 'https://custom-rpc.example.com/proxy'
});
```

## Safety Rules

- Default to `testnet`. Use `mainnet` only with explicit user approval because it uses real funds.
- Treat `send()` as irreversible. Confirm the recipient address before sending.
- Pass token amounts as strings in human units, for example `'1'` or `'1.5'`.
- Do not print, rewrite, or delete wallet key files under `~/.fast/keys/`.
- Prefer the SDK’s high-level methods over raw RPC calls.

## Core API

### Create or load a wallet

```ts
const client = fast({ network: 'testnet' });
const { address } = await client.setup();
```

- `setup()` creates or loads the wallet and persists network config.
- `client.address` is `null` before setup and a `fast1...` address after setup.

### Check balances

```ts
const native = await client.balance();
const usdc = await client.balance({ token: 'fastUSDC' });
const byId = await client.balance({ token: '0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5' });
```

- Native token defaults to `SET`.
- Custom tokens can be referenced by held symbol like `fastUSDC` or by hex token ID.

### Send tokens

```ts
const tx = await client.send({
  to: 'fast1...',
  amount: '1.25',
});
```

```ts
const tx = await client.send({
  to: 'fast1...',
  amount: '5',
  token: 'fastUSDC',
});
```

- Returns `{ txHash, explorerUrl }`.
- Validate the `fast1...` destination before calling `send()`.

### Sign and verify messages

```ts
const signed = await client.sign({ message: 'hello' });
const checked = await client.verify({
  message: 'hello',
  signature: signed.signature,
  address: signed.address,
});
```

- `message` may be a string or `Uint8Array`.
- `verify()` returns `{ valid: boolean }`.

### Inspect tokens and metadata

```ts
const holdings = await client.tokens();
const info = await client.tokenInfo({ token: 'fastUSDC' });
```

- `tokens()` lists held tokens with symbol, address, balance, and decimals.
- `tokenInfo()` returns metadata for a held token symbol or hex token ID.

### Export wallet info

```ts
const keys = await client.exportKeys();
```

- Returns only `{ publicKey, address }`.
- It never exposes the private key.

## Advanced API

Use these only when high-level helpers are insufficient.

```ts
const submitted = await client.submit({
  recipient: 'fast1...',
  claim: {
    TokenTransfer: {
      token_id: [/* 32 bytes */],
      amount: 'de0b6b3a7640000',
      user_data: null,
    },
  },
});

```

- `submit()` sends a low-level claim and returns `{ txHash, certificate }`.
- `submit()` `TokenTransfer.amount` is a hex string in raw base units (no `0x` prefix).
- Native `SET` uses 18 decimals: `0xde0b6b3a7640000` = 1 SET, `0x56bc75e2d63100000` = 100 SET.
- `fastUSDC` uses 6 decimals.

## Errors

Catch `FastError` and branch on `error.code`, not on raw message text.

```ts
import { FastError, fast } from '@fastxyz/sdk';

try {
  const client = fast({ network: 'testnet' });
  await client.setup();
  await client.send({ to: 'fast1...', amount: '10' });
} catch (error) {
  if (error instanceof FastError) {
    console.log(error.code, error.note);
  }
}
```

Common codes:

- `NETWORK_NOT_CONFIGURED`: call `setup()` first.
- `INSUFFICIENT_BALANCE`: fund the wallet or reduce the amount.
- `INVALID_ADDRESS`: stop and correct the destination.
- `TOKEN_NOT_FOUND`: use a held symbol or a valid hex token ID.
- `TX_FAILED`: retry once only if the user wants a retry.
- `INVALID_PARAMS` and `UNSUPPORTED_OPERATION`: read `error.note`.

## Local State

- Default config dir: `~/.fast`
- Override config dir: `FAST_CONFIG_DIR`
- Config file: `~/.fast/config.json`
- Key file: `~/.fast/keys/fast.json`
- Optional seed env var: `MONEY_FAST_PRIVATE_KEY`

## Not for This Skill

Do not use this SDK for:

- AllSet bridge flows
- swaps or routing
- staking, lending, or yield strategies
- generic EVM wallet operations outside Fast certificate handling
