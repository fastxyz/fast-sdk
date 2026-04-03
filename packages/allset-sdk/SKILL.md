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

# AllSet SDK Skill

## When to Use This Skill

**USE this skill when the user wants to:**
- Bridge tokens from EVM to Fast network (deposit / EVM → Fast)
- Bridge tokens from Fast to EVM (withdrawal / Fast → EVM)
- Execute custom intents on EVM via AllSet bridge
- Build or plan deposit transactions (pure, browser-safe helpers)
- Set up EVM wallets for bridging

**DO NOT use this skill for:**
- Fast-only operations (balance, send, sign) → use `@fastxyz/fast-sdk`
- EVM-only operations without bridging
- Swaps, lending, staking, or yield strategies

---

## Single Entrypoint

```ts
import { ... } from '@fastxyz/allset-sdk';
```

All functions are exported from the single root entry. No sub-paths.

---

## Workflows

### 1. Setup EVM Wallet

```ts
import { createEvmWallet, createEvmExecutor } from '@fastxyz/allset-sdk';

// Generate a new wallet (save privateKey to reuse)
const account = createEvmWallet();
console.log(account.address);    // 0x...
console.log(account.privateKey); // persist this

// Or restore from existing private key
const account = createEvmWallet('0x1234...64hexchars');

// Create viem clients (needed by executeDeposit)
const evmClients = createEvmExecutor(account, rpcUrl, chainId);
```

`createEvmWallet` accepts an optional hex private key. No keyfile loading.

---

### 2. Deposit (EVM → Fast)

**When:** User wants to move tokens from an EVM chain to their Fast address.

**Prerequisites:** EVM wallet with sufficient token balance + gas.

```ts
import { executeDeposit } from '@fastxyz/allset-sdk';

const result = await executeDeposit({
  chainId: 421614,                          // Arbitrum Sepolia
  bridgeContract: '0xb536...',             // AllSet bridge contract on EVM
  tokenAddress: '0x75fa...',              // ERC-20 token contract
  isNative: false,                          // true for ETH deposits
  amount: '1000000',                        // smallest units (e.g. 1 USDC = 1_000_000)
  senderAddress: account.address,
  receiverAddress: 'fast1abc...',          // Fast network bech32m address
  evmClients,
});

console.log(result.txHash);               // EVM tx hash
```

For ERC-20 tokens, `executeDeposit` automatically handles `approve` if allowance is insufficient.

**All addresses and URLs must be provided by the caller** — the SDK contains no embedded chain config.

---

### 3. Withdrawal (Fast → EVM)

**When:** User wants to move tokens from Fast network to an EVM address.

**Prerequisites:** Fast wallet with sufficient token balance.

```ts
import { executeIntent, buildTransferIntent } from '@fastxyz/allset-sdk';

// Simple withdrawal: transfer tokens to an EVM address
const intent = buildTransferIntent(tokenEvmAddress, receiverEvmAddress);

const result = await executeIntent({
  fastBridgeAddress: 'fast1bridge...',    // AllSet bridge address on Fast network
  relayerUrl: 'https://relayer.allset...', // AllSet relayer URL for destination chain
  crossSignUrl: 'https://cross-sign...',  // AllSet cross-sign service URL
  tokenEvmAddress: '0x75fa...',           // Token contract on EVM
  tokenFastTokenId: 'abc123...',          // Token ID on Fast network (hex, no 0x)
  amount: '1000000',
  intents: [intent],
  fastWallet,                              // Fast wallet (FastWalletLike)
});

console.log(result.txHash);
```

---

### 4. Execute Custom Intent

**When:** User wants to call a contract on EVM after bridging from Fast.

```ts
import { executeIntent, buildExecuteIntent } from '@fastxyz/allset-sdk';

const intent = buildExecuteIntent(targetContractAddress, encodedCalldata);

const result = await executeIntent({
  fastBridgeAddress: 'fast1bridge...',
  relayerUrl: 'https://relayer.allset...',
  crossSignUrl: 'https://cross-sign...',
  tokenEvmAddress: '0x75fa...',
  tokenFastTokenId: 'abc123...',
  amount: '1000000',
  intents: [intent],
  fastWallet,
});
```

---

### 5. Plan Deposit (Pure, No Execution)

**When:** Building a transaction to display or sign externally (browser-safe).

```ts
import { buildDepositTransaction } from '@fastxyz/allset-sdk';

const plan = buildDepositTransaction({
  chainId: 421614,
  bridgeContract: '0xb536...',
  tokenAddress: '0x75fa...',
  amount: 1000000n,       // bigint
  receiver: 'fast1abc...',
});

// plan.to, plan.data, plan.value — ready to send via walletClient
```

---

### 6. Address Utilities

```ts
import { fastAddressToBytes32, fastAddressToBytes } from '@fastxyz/allset-sdk';

const bytes32 = fastAddressToBytes32('fast1abc...');  // Hex<0x...>
const bytes   = fastAddressToBytes('fast1abc...');    // Uint8Array
```

---

### 7. Intent Builders (Pure)

```ts
import {
  buildTransferIntent,
  buildExecuteIntent,
  buildDepositBackIntent,
  buildRevokeIntent,
} from '@fastxyz/allset-sdk';

// Transfer tokens to an EVM address
const i1 = buildTransferIntent(tokenAddress, receiverEvmAddress);

// Call a contract on EVM
const i2 = buildExecuteIntent(targetAddress, calldata, valueInWei?);

// Deposit tokens back to a Fast address
const i3 = buildDepositBackIntent(tokenAddress, fastReceiverAddress);

// Revoke a pending intent
const i4 = buildRevokeIntent();
```

---

### 8. evmSign (Cross-signing)

```ts
import { evmSign } from '@fastxyz/allset-sdk';

// Used internally by executeIntent. Available standalone for advanced flows.
const result = await evmSign(certificate, crossSignUrl);
// result: { transaction: number[], signature: string }
```

---

## Error Handling

```ts
import { FastError } from '@fastxyz/allset-sdk';

try {
  await executeDeposit({ ... });
} catch (err) {
  if (err instanceof FastError) {
    console.error(err.code);     // e.g. 'TX_FAILED', 'INVALID_ADDRESS', 'INVALID_PARAMS'
    console.error(err.message);
    console.error(err.context);  // { note: '...' }
  }
}
```

**Error codes:**
| Code | When |
|---|---|
| `TX_FAILED` | EVM tx reverted, cross-sign failed, relayer rejected |
| `INVALID_ADDRESS` | Bad Fast address passed as receiver |
| `INVALID_PARAMS` | Missing/wrong params (e.g. no intents) |

---

## Supported Chains (CHAIN_MAP)

| Chain ID | Network |
|---|---|
| 11155111 | Sepolia |
| 421614 | Arbitrum Sepolia |
| 42161 | Arbitrum One |
| 8453 | Base |

`createEvmExecutor` throws if the chain ID is not in this map.

---

## FastWalletLike Interface

`executeIntent` requires a `fastWallet` that implements:

```ts
interface FastWalletLike {
  readonly address: string;  // fast1... bech32m
  submit(params: {
    claim: Record<string, unknown>;
  }): Promise<{
    txHash: string;
    certificate: unknown;
  }>;
}
```

Use `@fastxyz/fast-sdk` to create a conforming Fast wallet.
