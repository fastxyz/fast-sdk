# @fastxyz/allset-sdk

AllSet SDK for bridging tokens between [Fast network](https://fast.xyz) and EVM chains.

- **EVM → Fast (deposit):** `executeDeposit()`
- **Fast → EVM (withdrawal):** `executeIntent()` + intent builder
- **Pure helpers:** `buildDepositTransaction()`, intent builders, address utils — browser-safe

**Design:** All functions are pure — no embedded chain config, no file system access, no environment variable reads. The caller provides all addresses, URLs, and credentials.

---

## Installation

```bash
npm install @fastxyz/allset-sdk
# or
pnpm add @fastxyz/allset-sdk
```

**Peer dependencies:** `viem` (used internally)

---

## Quick Start

### Deposit (EVM → Fast)

```ts
import { createEvmWallet, createEvmExecutor, executeDeposit } from '@fastxyz/allset-sdk';

const account = createEvmWallet('0xYourPrivateKey');
const evmClients = createEvmExecutor(account, 'https://arb-sepolia.rpc...', 421614);

const result = await executeDeposit({
  chainId: 421614,
  bridgeContract: '0xb536...',   // AllSet bridge contract on Arbitrum Sepolia
  tokenAddress: '0x75fa...',    // USDC on Arbitrum Sepolia
  amount: '1000000',             // 1 USDC (6 decimals)
  senderAddress: account.address,
  receiverAddress: 'fast1abc...', // your Fast address
  evmClients,
});

console.log(result.txHash); // EVM transaction hash
```

### Withdrawal (Fast → EVM)

```ts
import { executeIntent, buildTransferIntent } from '@fastxyz/allset-sdk';

const intent = buildTransferIntent('0x75fa...', '0xReceiverEVM...');

const result = await executeIntent({
  fastBridgeAddress: 'fast1bridge...',
  relayerUrl: 'https://relayer.allset...',
  crossSignUrl: 'https://cross-sign.allset...',
  tokenEvmAddress: '0x75fa...',
  tokenFastTokenId: 'abc123...',  // hex token ID on Fast network (no 0x)
  amount: '1000000',
  intents: [intent],
  fastWallet,                      // @fastxyz/fast-sdk wallet
});
```

---

## API Reference

### Wallet & Clients

#### `createEvmWallet(privateKey?): EvmAccount`

Creates an EVM wallet. Generates a new random wallet if `privateKey` is omitted.

```ts
const account = createEvmWallet();            // random
const account = createEvmWallet('0xabc123...'); // from existing key
// account.privateKey — hex key (persist to reuse)
// account.address    — 0x address
```

#### `createEvmExecutor(account, rpcUrl, chainId): EvmClients`

Creates viem `walletClient` and `publicClient` for the given chain.

```ts
const { walletClient, publicClient } = createEvmExecutor(account, rpcUrl, 421614);
```

Supported chain IDs: `11155111` (Sepolia), `421614` (Arbitrum Sepolia), `42161` (Arbitrum), `8453` (Base).

---

### Bridge Execution

#### `executeDeposit(params): Promise<BridgeResult>`

Executes an EVM → Fast deposit. For ERC-20 tokens, automatically submits an `approve` transaction if the current allowance is insufficient.

```ts
interface ExecuteDepositParams {
  chainId: number;
  bridgeContract: `0x${string}`;
  tokenAddress: `0x${string}`;
  isNative?: boolean;        // true for ETH deposits
  amount: string;            // smallest units as string
  senderAddress: string;
  receiverAddress: string;   // Fast bech32m address (fast1...)
  evmClients: EvmClients;
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
  tokenFastTokenId: string;   // hex, no 0x prefix
  amount: string;
  intents: Intent[];
  externalAddress?: string;   // override EVM target (required for depositBack/revoke flows)
  deadlineSeconds?: number;   // default: 3600
  fastWallet: FastWalletLike;
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
  amount: 1000000n,       // bigint
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
import { FastError } from '@fastxyz/allset-sdk';

try {
  await executeDeposit({ ... });
} catch (err) {
  if (err instanceof FastError) {
    console.error(err.code);     // 'TX_FAILED' | 'INVALID_ADDRESS' | 'INVALID_PARAMS'
    console.error(err.message);
    console.error(err.context);
  }
}
```

---

## Types

```ts
interface BridgeResult {
  txHash: string;
  orderId: string;
  estimatedTime?: string;
}

interface FastWalletLike {
  readonly address: string;  // fast1... bech32m
  submit(params: { claim: Record<string, unknown> }): Promise<{
    txHash: string;
    certificate: unknown;
  }>;
}
```

---

## Changelog

**v0.x (current)**
- Pure-function API — no `AllSetProvider`, no embedded config, no keyfile loading
- Single entrypoint `@fastxyz/allset-sdk` (no sub-path exports)
- All config values passed as explicit function parameters
