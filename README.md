# Fast SDK

Standalone Fast chain SDK extracted from `/Users/chris/Documents/Workspace/money`.

This repo contains only `@pi2labs/fast-sdk`. It does not include the AllSet SDK or the old workspace wiring from the `money` monorepo.

## Install

```bash
npm install
```

## Scripts

```bash
npm run build
npm test
```

## Usage

```ts
import { fast } from '@pi2labs/fast-sdk';

const client = fast({ network: 'testnet' });
await client.setup();

const balance = await client.balance();
console.log(balance);
```
