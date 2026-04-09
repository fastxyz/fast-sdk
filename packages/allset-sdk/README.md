---
name: allset-sdk
description: >
  AllSet SDK for bridging tokens between Fast network and EVM chains. Use executeDeposit
  for EVM → Fast deposits and executeIntent for Fast → EVM withdrawals or custom operations.
  All functions are pure — no embedded config, no file system access. Caller provides all
  chain/contract addresses.
metadata:
  short-description: Bridge tokens between Fast and EVM chains (pure functions, no config).
  compatibility: Node.js 20+; browser-safe pure helpers (address, deposit, intents).
---

# @fastxyz/allset-sdk

AllSet SDK for bridging tokens between [Fast network](https://fast.xyz) and EVM chains.

- **EVM → Fast (deposit):** `executeDeposit()`
- **Fast → EVM (withdrawal):** `executeWithdraw()` or `executeIntent()` + intent builders
- **Pure helpers:** `buildDepositTransaction()`, intent builders, address utils — browser-safe

**Design:** All functions are pure — no embedded chain config, no file system access, no environment variable reads. The caller provides all addresses, URLs, and credentials.

---

## Use Cases

- Bridge tokens from EVM to Fast network (deposit / EVM → Fast)
- Bridge tokens from Fast to EVM (withdrawal / Fast → EVM)
- Execute custom intents on EVM via AllSet bridge
- Build or plan deposit transactions (pure, browser-safe helpers)
- Set up EVM wallets for bridging

**Out of scope:** Fast-only operations (balance, send, sign) → [`@fastxyz/sdk`](../fast-sdk) · EVM-only operations without bridging · Swaps, lending, or staking

All functions are exported from a single root entrypoint — no sub-paths:

```ts
import { ... } from '@fastxyz/allset-sdk';
```

---

## Installation

```bash
npm install @fastxyz/allset-sdk
# or
pnpm add @fastxyz/allset-sdk
```

**Peer dependencies:** `viem` (used internally)

---

## Workflows

### Deposit (EVM → Fast)

```ts
import { createEvmWallet, createEvmExecutor, executeDeposit } from '@fastxyz/allset-sdk';

const account = createEvmWallet('0xYourPrivateKey');
const evmClients = createEvmExecutor(account, 'https://your-evm-rpc...', 421614);

const result = await executeDeposit({
  chainId: 421614,
  bridgeContract: '0xb536...', // AllSet bridge contract on Arbitrum Sepolia
  tokenAddress: '0x75fa...', // USDC on Arbitrum Sepolia
  amount: '1000000', // 1 USDC (6 decimals)
  senderAddress: account.address,
  receiverAddress: 'fast1abc...', // your Fast address
  evmClients,
});

console.log(result.txHash); // EVM transaction hash
```

### Withdrawal (Fast → EVM)

```ts
import { Signer, FastProvider } from '@fastxyz/sdk';
import { executeWithdraw } from '@fastxyz/allset-sdk';

const signer = new Signer('0xYourPrivateKey');
const provider = new FastProvider({ rpcUrl: 'https://your-fast-rpc...' });

const result = await executeWithdraw({
  fastBridgeAddress: 'fast1bridge...',
  relayerUrl: 'https://relayer.allset...',
  crossSignUrl: 'https://cross-sign.allset...',
  tokenEvmAddress: '0x75fa...',
  tokenFastTokenId: 'abc123...', // hex token ID on Fast network (no 0x)
  amount: '1000000',
  receiverEvmAddress: '0xReceiverEVM...',
  networkId: 'fast:testnet', // or 'fast:mainnet'
  signer,
  provider,
});

console.log(result.txHash);
```

### Withdrawal with custom intents

```ts
import { Signer, FastProvider } from '@fastxyz/sdk';
import { executeIntent, buildTransferIntent } from '@fastxyz/allset-sdk';

const signer = new Signer('0xYourPrivateKey');
const provider = new FastProvider({ rpcUrl: 'https://...' });

const result = await executeIntent({
  fastBridgeAddress: 'fast1bridge...',
  relayerUrl: 'https://relayer.allset...',
  crossSignUrl: 'https://cross-sign.allset...',
  tokenEvmAddress: '0x75fa...',
  tokenFastTokenId: 'abc123...',
  amount: '1000000',
  intents: [buildTransferIntent('0x75fa...', '0xReceiverEVM...')],
  networkId: 'fast:testnet',
  signer,
  provider,
});
```

---

## API Reference

### Wallet & Clients

#### `createEvmWallet(privateKey?): EvmAccount`

Creates an EVM wallet. Generates a new random wallet if `privateKey` is omitted.

```ts
const account = createEvmWallet(); // random
const account = createEvmWallet('0xabc123...'); // from existing key
// account.privateKey — hex key (persist to reuse)
// account.address    — 0x address
```

#### `createEvmExecutor(account, rpcUrl, chainId): EvmClients`

Creates viem `walletClient` and `publicClient` for the given chain.

```ts
const { walletClient, publicClient } = createEvmExecutor(account, rpcUrl, 421614);
```

Supported chain IDs: `1` (Ethereum), `11155111` (Sepolia), `421614` (Arbitrum Sepolia), `42161` (Arbitrum), `8453` (Base).

---

### Bridge Execution

#### `executeDeposit(params): Promise<BridgeResult>`

Executes an EVM → Fast deposit. For ERC-20 tokens, automatically submits an `approve` transaction if the current allowance is insufficient.

> **Note:** `isNative` is only for native EVM assets (ETH). All ERC-20 tokens (including USDC, USDT, etc.) use `tokenAddress` and `isNative: false` (the default). Do not set `isNative: true` for ERC-20 tokens.

```ts
interface ExecuteDepositParams {
  chainId: number;
  bridgeContract: `0x${string}`;
  tokenAddress: `0x${string}`; // ERC-20 contract address (or zero address for native ETH when isNative=true)
  isNative?: boolean; // true only for native ETH deposits; false (default) for all ERC-20 tokens
  amount: string; // smallest units as string
  senderAddress: string;
  receiverAddress: string; // Fast bech32m address (fast1...)
  evmClients: EvmClients;
}
```

#### `executeWithdraw(params): Promise<BridgeResult>`

Executes a simple Fast → EVM token withdrawal. Automatically builds a `DynamicTransfer` intent for the given receiver address.

```ts
interface ExecuteWithdrawParams {
  fastBridgeAddress: string;
  relayerUrl: string;
  crossSignUrl: string;
  tokenEvmAddress: string;
  tokenFastTokenId: string; // hex, no 0x prefix
  amount: string;
  receiverEvmAddress: string; // EVM address to receive tokens
  deadlineSeconds?: number; // default: 3600
  networkId: string; // 'fast:testnet' | 'fast:mainnet' | ...
  signer: Signer; // from @fastxyz/sdk
  provider: FastProvider; // from @fastxyz/sdk
}
```

#### `executeIntent(params): Promise<BridgeResult>`

Executes Fast → EVM bridge with custom intents. Internally:

1. Transfers tokens to the bridge on Fast network
2. Cross-signs the transfer certificate
3. Submits intent claim on Fast network
4. Cross-signs the intent certificate
5. Submits to the relayer for EVM execution

```ts
interface ExecuteIntentParams {
  fastBridgeAddress: string;
  relayerUrl: string;
  crossSignUrl: string;
  tokenEvmAddress: string;
  tokenFastTokenId: string; // hex, no 0x prefix
  amount: string;
  intents: Intent[];
  externalAddress?: string; // override EVM target (required for depositBack/revoke flows)
  deadlineSeconds?: number; // default: 3600
  networkId: string; // 'fast:testnet' | 'fast:mainnet' | ...
  signer: Signer; // from @fastxyz/sdk
  provider: FastProvider; // from @fastxyz/sdk
}
```

#### `evmSign(certificate, crossSignUrl): Promise<EvmSignResult>`

Cross-signs a Fast network certificate with the AllSet cross-sign service.

---

### Intent Builders (Pure)

```ts
buildTransferIntent(tokenAddress, receiverEvmAddress): Intent
buildExecuteIntent(targetAddress, calldata, value?): Intent
buildDepositBackIntent(tokenAddress, fastReceiverAddress): Intent
buildRevokeIntent(): Intent
```

---

### Deposit Planning (Pure, Browser-Safe)

#### `buildDepositTransaction(params): DepositTransactionPlan`

Builds a deposit transaction without executing it. Useful for displaying, signing externally, or constructing in a browser.

```ts
const plan = buildDepositTransaction({
  chainId: 421614,
  bridgeContract: '0xb536...',
  tokenAddress: '0x75fa...',
  amount: 1000000n, // bigint
  receiver: 'fast1abc...',
});
// plan.to, plan.data, plan.value — pass to walletClient.sendTransaction()
```

#### `encodeDepositCalldata(params): Hex`

Encodes only the calldata for a deposit call.

---

### Address Utilities (Pure, Browser-Safe)

```ts
fastAddressToBytes32(address: string): Hex        // bech32m → 0x bytes32
fastAddressToBytes(address: string): Uint8Array   // bech32m → Uint8Array
```

---

### Error Handling

```ts
import { FastError, type FastErrorCode } from '@fastxyz/allset-sdk';

try {
  await executeWithdraw({ ... });
} catch (err) {
  if (err instanceof FastError) {
    console.error(err.code);     // 'TX_FAILED' | 'INVALID_ADDRESS' | 'INVALID_PARAMS'
    console.error(err.message);
    console.error(err.context);
  }
}
```

### Claims Encoding (Low-Level)

`claims.ts` provides standalone functions for encoding AllSet bridge claims. These are used internally by `executeIntent()` but can also be used directly for custom flows:

```ts
import {
  encodeTransferClaim,
  hashTransferClaim,
  encodeIntentClaim,
  buildIntentClaimBytes,
  extractClaimId,
  type TransferClaimParams,
  type IntentClaimParams,
} from '@fastxyz/allset-sdk';

// Encode a transfer claim for cross-signing
const claimBytes = encodeTransferClaim({
  fastAddress: 'fast1sender...',
  tokenFastTokenId: 'abc123...',
  amount: '1000000',
  recipientEvmAddress: '0xReceiver...',
  bridgeAddress: 'fast1bridge...',
  nonce: 0n,
  timestamp: BigInt(Math.floor(Date.now() / 1000)),
});

// Hash a transfer claim
const claimHash = hashTransferClaim({ ... });

// Encode an intent claim
const intentBytes = encodeIntentClaim({
  externalAddress: '0xTarget...',
  tokenEvmAddress: '0xUSDC...',
  amount: '1000000',
  fastAddress: 'fast1sender...',
  transferClaimId: '0xabc...',
  externalCallDeadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
});

// Extract the claim ID from cross-sign transaction output
const claimId = extractClaimId(crossSignTransaction); // Uint8Array
```

### Relay Submission (Low-Level)

`relay.ts` provides a standalone function for submitting to the AllSet relayer. Use this for step-by-step flows, retry logic, or when you want to separate relay submission from the rest of the bridge flow:

```ts
import { relayExecute, type RelayParams } from '@fastxyz/allset-sdk';

const result = await relayExecute({
  relayerUrl: 'https://relayer.allset...',
  encodedTransferClaim: [...],   // from evmSign result
  transferProof: '0x...',         // EVM signature over the transfer claim
  transferFastTxId: '0x...',      // Fast network tx ID for the transfer
  fastsetAddress: 'fast1bridge...',
  externalAddress: '0xTarget...',
  encodedIntentClaim: [...],      // from evmSign result
  intentProof: '0x...',            // EVM signature over the intent claim
  intentClaimId: '0xabc...',
});

console.log(result.relayTxHash); // EVM transaction hash from the relayer
```

---

## Types

```ts
interface BridgeResult {
  txHash: string;
  orderId: string;
  estimatedTime?: string;
}

type FastErrorCode = 'TX_FAILED' | 'INVALID_ADDRESS' | 'INVALID_PARAMS' | 'CROSS_SIGN_FAILED' | 'RELAY_FAILED';

class FastError extends Error {
  readonly code: FastErrorCode;
  readonly context?: Record<string, unknown>;
}

interface TransferClaimParams {
  fastAddress: string;
  tokenFastTokenId: string;
  amount: string;
  recipientEvmAddress: string;
  bridgeAddress: string;
  nonce: bigint;
  timestamp: bigint;
}

interface IntentClaimParams {
  externalAddress: string;
  tokenEvmAddress: string;
  amount: string;
  fastAddress: string;
  transferClaimId: string;
  externalCallDeadline: bigint;
}

interface RelayParams {
  relayerUrl: string;
  encodedTransferClaim: number[];
  transferProof: string;
  transferFastTxId: string;
  fastsetAddress: string;
  externalAddress: string;
  encodedIntentClaim: number[];
  intentProof: string;
  intentClaimId: string;
}

interface RelayResult {
  relayTxHash: string;
}
```

---

## Changelog

**v0.x (current)**

- `executeWithdraw()` — new convenience function for simple Fast → EVM withdrawals
- `executeIntent()` / `executeWithdraw()` now accept `signer`, `provider`, `networkId` from `@fastxyz/sdk` (replaces `FastWalletLike`)
- Added Ethereum mainnet (chainId 1) support
- Pure-function API — no `AllSetProvider`, no embedded config, no keyfile loading
- Single entrypoint `@fastxyz/allset-sdk` (no sub-path exports)
- All config values passed as explicit function parameters
