import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { FastError, IndeterminateTransactionError, PostPaymentRecoveryError } from '../src/errors.ts';
import { encodeFunctionData, hexToBytes, type Hex } from 'viem';
import { hashHex, InvalidRequestError, Signer, FastProvider, toFastAddress } from '@fastxyz/sdk';
import { Schema } from 'effect';
import { bcsSchema, TransactionCertificateFromRpc, VersionedTransactionFromBcs } from '@fastxyz/schema';

import {
  // address
  fastAddressToBytes32,
  fastAddressToBytes,
  bytes32ToFastAddress,
  // deposit
  buildDepositTransaction,
  encodeDepositCalldata,
  // intents
  IntentAction,
  buildTransferIntent,
  buildExecuteIntent,
  buildDepositBackIntent,
  buildRevokeIntent,
  decodeIntentClaimV1,
  transferUserDataTag,
  // evm-executor
  createEvmWallet,
  createEvmExecutor,
  // bridge
  evmSign,
  executeDeposit,
  executeIntent,
  executeWithdraw,
  relayExecute,
  type RelayResult,
  // eip7702
  smartDeposit,
  InsufficientBalanceError,
  CHAIN_MAP,
  arc,
  gasTokenErc20,
  weiToTokenUnits,

} from '../src/index.ts';
import { encodeIntentClaim } from '../src/claims.ts';

const FAST_ADDRESS = 'fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv';
const EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
const TX_HASH = `0x${'11'.repeat(32)}`;
const BRIDGE_CONTRACT = '0xb53600976275D6f541a3B929328d07714EFA581F' as `0x${string}`;
const TOKEN_ADDRESS = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as `0x${string}`;
const FAST_BRIDGE_ADDRESS = 'fast1tkmtqxulhnzeeg9zhuwxy3x95wr7waytm9cq40ndf7tkuwwcc6jseg24j8';
const RELAY_URL = 'https://testnet.allset.fast.xyz/arbitrum-sepolia/relayer';
const CROSS_SIGN_URL = 'https://testnet.cross-sign.allset.fast.xyz';
const TOKEN_FAST_ID = 'd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46';
const RELAY_ACCEPTED = {
  success: true,
  message: 'Job queued for processing',
  block_number: null,
  job_id: 'test-job',
};

const MOCK_CROSS_SIGN_TX = [...Array(32).fill(0), ...Array(32).fill(0x11)];

const hashRecoveryEnvelope = async (envelope: any): Promise<string> =>
  hashHex(
    bcsSchema.VersionedTransaction,
    Schema.encodeSync(VersionedTransactionFromBcs)(envelope.transaction),
  );

const restoreJsonSafeBytes = (value: any): any => {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return Uint8Array.from(value);
    }
    return value.map(restoreJsonSafeBytes);
  }
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, restoreJsonSafeBytes(nested)]));
  }
  return value;
};

// Decoded TypeScript-form certificate (decoded from real testnet wire data)
const MOCK_CERTIFICATE = Schema.decodeUnknownSync(TransactionCertificateFromRpc)({
  envelope: {
    transaction: {
      Release20260319: {
        network_id: 'fast:testnet',
        sender: [
          209, 137, 109, 120, 122, 63, 156, 194, 212, 170, 221, 193, 4, 58, 6, 217, 71, 137, 93, 252, 177, 177, 165, 12, 25, 82, 50, 75, 37, 79, 156,
          133,
        ],
        nonce: 96,
        timestamp_nanos: 1775199848200000000,
        claim: {
          TokenTransfer: {
            token_id: [
              215, 58, 6, 121, 162, 190, 70, 152, 30, 42, 138, 237, 236, 217, 81, 200, 182, 105, 14, 125, 95, 133, 2, 179, 78, 211, 255, 76, 194, 22,
              59, 70,
            ],
            recipient: [
              93, 182, 176, 27, 159, 188, 197, 156, 160, 162, 191, 28, 98, 68, 197, 163, 135, 231, 116, 139, 217, 112, 10, 190, 109, 79, 151, 110, 57,
              216, 198, 165,
            ],
            amount: '2710',
            user_data: null,
          },
        },
        archival: false,
        fee_token: null,
      },
    },
    signature: {
      Signature: [
        243, 181, 0, 134, 119, 52, 155, 173, 156, 16, 7, 113, 166, 14, 189, 123, 237, 154, 157, 120, 164, 45, 11, 79, 83, 128, 25, 1, 46, 120, 149,
        38, 86, 187, 164, 193, 214, 98, 69, 92, 163, 93, 57, 82, 1, 29, 11, 233, 18, 62, 220, 251, 173, 145, 79, 122, 211, 239, 73, 130, 155, 169,
        232, 10,
      ],
    },
  },
  signatures: [
    [
      [
        236, 249, 103, 252, 146, 0, 130, 223, 133, 72, 40, 87, 67, 21, 187, 13, 100, 52, 193, 194, 242, 152, 67, 181, 8, 2, 150, 72, 51, 230, 245,
        169,
      ],
      [
        192, 157, 3, 79, 239, 43, 131, 115, 120, 48, 145, 170, 248, 129, 187, 246, 86, 115, 121, 21, 67, 197, 151, 204, 195, 214, 61, 200, 206, 120,
        91, 73, 170, 48, 108, 41, 230, 184, 237, 46, 120, 92, 207, 52, 130, 186, 64, 60, 8, 25, 112, 168, 42, 98, 32, 100, 222, 183, 5, 101, 54, 231,
        96, 10,
      ],
    ],
  ],
});

// ---------------------------------------------------------------------------
// Entrypoint Tests
// ---------------------------------------------------------------------------

test('single entrypoint exposes all public API', () => {
  assert.equal(typeof fastAddressToBytes32, 'function');
  assert.equal(typeof buildDepositTransaction, 'function');
  assert.equal(typeof buildTransferIntent, 'function');
  assert.equal(typeof createEvmWallet, 'function');
  assert.equal(typeof executeDeposit, 'function');
  assert.equal(typeof executeIntent, 'function');
  assert.equal(typeof executeWithdraw, 'function');
  assert.equal(typeof evmSign, 'function');
});

test('IndeterminateTransactionError preserves recovery details in JSON', () => {
  const error = new IndeterminateTransactionError({
    stage: 'intent',
    txHash: `0x${'aa'.repeat(32)}`,
    relatedTxHash: `0x${'bb'.repeat(32)}`,
    recoveryEnvelope: {
      transaction: {
        value: {
          nonce: 7n,
          sender: new Uint8Array([1, 2, 3]),
        },
      },
    },
  });

  const json = JSON.parse(JSON.stringify(error));
  assert.equal(json.code, 'TX_INDETERMINATE');
  assert.equal(json.stage, 'intent');
  assert.equal(json.txHash, `0x${'aa'.repeat(32)}`);
  assert.equal(json.relatedTxHash, `0x${'bb'.repeat(32)}`);
  assert.equal(json.mayHaveSettled, true);
  assert.deepEqual(json.recoveryEnvelope.transaction.value, {
    nonce: '7',
    sender: [1, 2, 3],
  });
});

test('removed APIs are no longer exported', async () => {
  const mod = (await import('../src/index.ts')) as Record<string, unknown>;
  assert.equal('AllSetProvider' in mod, false);
  assert.equal('executeBridge' in mod, false);
  assert.equal('resolveDepositRoute' in mod, false);
  assert.equal('getChainConfig' in mod, false);
  assert.equal('getTokenConfig' in mod, false);
  assert.equal('loadNetworksConfig' in mod, false);
  assert.equal('getAllSetDir' in mod, false);
  assert.equal('initUserConfig' in mod, false);
});

// ---------------------------------------------------------------------------
// Address Tests
// ---------------------------------------------------------------------------

test('fastAddressToBytes32 converts a Fast address to bytes32', () => {
  assert.equal(fastAddressToBytes32(FAST_ADDRESS), '0x1c0c991ea4bc21608f48a7fea5b7c1b5a2d9fe0977db0df5d8ed4aa502716818');
});

test('fastAddressToBytes32 rejects invalid Fast addresses', () => {
  assert.throws(() => fastAddressToBytes32('fast1invalid'), /Invalid Fast address "fast1invalid"/);
});

test('address byte conversions reject non-32-byte values', () => {
  assert.throws(
    () => fastAddressToBytes32(toFastAddress(new Uint8Array(31))),
    /expected 32 bytes/i,
  );
  assert.throws(
    () => bytes32ToFastAddress(('0x' + '11'.repeat(31)) as Hex),
    /expected 32 bytes/i,
  );
  assert.throws(
    () => bytes32ToFastAddress(('0x' + '11'.repeat(33)) as Hex),
    /expected 32 bytes/i,
  );
  assert.equal(
    bytes32ToFastAddress(('0x' + '11'.repeat(32)) as Hex),
    toFastAddress(new Uint8Array(32).fill(0x11)),
  );
});

test('fastAddressToBytes returns a 32-byte Uint8Array', () => {
  const bytes = fastAddressToBytes(FAST_ADDRESS);
  assert.equal(bytes.length, 32);
  assert.ok(bytes instanceof Uint8Array);
});

// ---------------------------------------------------------------------------
// Deposit Transaction Tests
// ---------------------------------------------------------------------------

test('encodeDepositCalldata matches deposit(address,uint256,bytes32) ABI encoding', () => {
  const receiverBytes32 = fastAddressToBytes32(FAST_ADDRESS);
  const expected = encodeFunctionData({
    abi: [
      {
        type: 'function' as const,
        name: 'deposit' as const,
        inputs: [
          { name: 'token', type: 'address' as const },
          { name: 'amount', type: 'uint256' as const },
          { name: 'receiver', type: 'bytes32' as const },
        ],
        outputs: [],
        stateMutability: 'payable' as const,
      },
    ],
    functionName: 'deposit',
    args: [TOKEN_ADDRESS, 1_000_000n, receiverBytes32],
  });

  assert.equal(encodeDepositCalldata({ tokenAddress: TOKEN_ADDRESS, amount: 1_000_000n, receiverBytes32 }), expected);
});

test('buildDepositTransaction returns correct plan', () => {
  const plan = buildDepositTransaction({
    chainId: 421614,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS,
    amount: 1_000_000n,
    receiver: FAST_ADDRESS,
  });

  assert.equal(plan.chainId, 421614);
  assert.equal(plan.to, BRIDGE_CONTRACT);
  assert.equal(plan.value, 0n);
  assert.ok(plan.data.startsWith('0x'));
  assert.ok(plan.receiverBytes32.startsWith('0x'));
});

test('buildDepositTransaction with isNative sets value to amount', () => {
  const plan = buildDepositTransaction({
    chainId: 421614,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS,
    isNative: true,
    amount: 1_000_000n,
    receiver: FAST_ADDRESS,
  });

  assert.equal(plan.value, 1_000_000n);
});

test('buildDepositTransaction rejects invalid Fast receiver address', () => {
  assert.throws(
    () =>
      buildDepositTransaction({
        chainId: 421614,
        bridgeContract: BRIDGE_CONTRACT,
        tokenAddress: TOKEN_ADDRESS,
        amount: 1_000_000n,
        receiver: 'notavalidaddress',
      }),
    /Invalid Fast address/,
  );
});

// ---------------------------------------------------------------------------
// Intent Builder Tests
// ---------------------------------------------------------------------------

test('buildTransferIntent creates correct DynamicTransfer intent', () => {
  const intent = buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS);
  assert.equal(intent.action, IntentAction.DynamicTransfer);
  assert.ok(intent.payload.startsWith('0x'));
  assert.equal(intent.value, 0n);
});

test('buildExecuteIntent creates correct Execute intent with value', () => {
  const intent = buildExecuteIntent(TOKEN_ADDRESS, '0xabcdef', 100n);
  assert.equal(intent.action, IntentAction.Execute);
  assert.ok(intent.payload.startsWith('0x'));
  assert.equal(intent.value, 100n);
});

test('buildExecuteIntent defaults value to 0', () => {
  const intent = buildExecuteIntent(TOKEN_ADDRESS, '0xabcdef');
  assert.equal(intent.value, 0n);
});

test('buildDepositBackIntent creates correct DynamicDeposit intent', () => {
  const intent = buildDepositBackIntent(TOKEN_ADDRESS, FAST_ADDRESS);
  assert.equal(intent.action, IntentAction.DynamicDeposit);
  assert.ok(intent.payload.startsWith('0x'));
  assert.equal(intent.value, 0n);
});

test('buildRevokeIntent creates correct Revoke intent', () => {
  const intent = buildRevokeIntent();
  assert.equal(intent.action, IntentAction.Revoke);
  assert.equal(intent.payload, '0x');
  assert.equal(intent.value, 0n);
});

// ---------------------------------------------------------------------------
// EVM Executor / Wallet Tests
// ---------------------------------------------------------------------------

test('createEvmWallet generates new wallet when no args', () => {
  const account = createEvmWallet();
  assert.ok(account.address.startsWith('0x'));
  assert.equal(account.address.length, 42);
  assert.ok(account.privateKey.startsWith('0x'));
  assert.equal(account.privateKey.length, 66);
  assert.equal(createEvmWallet(account.privateKey).address, account.address);

  const account2 = createEvmWallet();
  assert.notEqual(account.address, account2.address);
});

test('createEvmWallet derives account from private key string', () => {
  const privateKey = `0x${'55'.repeat(32)}`;
  const account = createEvmWallet(privateKey);
  assert.ok(account.address.startsWith('0x'));
  assert.equal(account.privateKey, privateKey);
  assert.equal(createEvmWallet(privateKey).address, account.address);

  // Also works without 0x prefix
  const account2 = createEvmWallet('55'.repeat(32));
  assert.equal(account.address, account2.address);
});

test('createEvmExecutor rejects unsupported chain ids', () => {
  const account = createEvmWallet(`0x${'11'.repeat(32)}`);
  assert.throws(() => createEvmExecutor(account, 'http://localhost:8545', 999999), /Unsupported EVM chain ID/);
});

test('createEvmExecutor supports ethereum mainnet (chainId 1)', () => {
  const account = createEvmWallet(`0x${'11'.repeat(32)}`);
  const clients = createEvmExecutor(account, 'https://mainnet.example.com', 1);
  assert.ok(clients.walletClient);
  assert.ok(clients.publicClient);
});

test('createEvmExecutor maps chainId 5042 to Arc on both clients', () => {
  const account = createEvmWallet(`0x${'33'.repeat(32)}`);
  const clients = createEvmExecutor(account, 'https://allset.fast.xyz/chain/rpc/arc', 5042);
  assert.equal(clients.walletClient.chain?.id, 5042);
  assert.equal(clients.publicClient.chain?.id, 5042);
  assert.equal(clients.publicClient.chain?.name, 'Arc');
  assert.equal(clients.publicClient.chain?.nativeCurrency.symbol, 'USDC');
  assert.equal(CHAIN_MAP[5042], arc);
});

test('gasTokenErc20 is set for Arc only', () => {
  assert.equal(gasTokenErc20(arc), '0x3600000000000000000000000000000000000000');
  assert.equal(gasTokenErc20(CHAIN_MAP[1]), undefined);
  assert.equal(gasTokenErc20(CHAIN_MAP[8453]), undefined);
  assert.equal(gasTokenErc20(undefined), undefined);
});

test('weiToTokenUnits converts 18-decimal wei to 6-decimal units, rounding up', () => {
  assert.equal(weiToTokenUnits(0n, 6), 0n);
  assert.equal(weiToTokenUnits(1n, 6), 1n);
  assert.equal(weiToTokenUnits(10n ** 12n, 6), 1n);
  assert.equal(weiToTokenUnits(10n ** 12n + 1n, 6), 2n);
  // 20 gwei * 300k gas * 2 = 0.012 USDC on Arc
  assert.equal(weiToTokenUnits(20n * 10n ** 9n * 300_000n * 2n, 6), 12_000n);
  assert.equal(weiToTokenUnits(5n * 10n ** 18n, 18), 5n * 10n ** 18n);
  // more than 18 decimals scales up exactly instead of throwing
  assert.equal(weiToTokenUnits(1n, 24), 10n ** 6n);
  assert.equal(weiToTokenUnits(20n * 10n ** 9n * 300_000n * 2n, 24), 12n * 10n ** 21n);
  assert.equal(weiToTokenUnits(7n, 0), 1n);
  assert.throws(() => weiToTokenUnits(1n, -1), RangeError);
  assert.throws(() => weiToTokenUnits(1n, 6.5), RangeError);
});

test('createEvmExecutor returns walletClient and publicClient', () => {
  const account = createEvmWallet(`0x${'22'.repeat(32)}`);
  const clients = createEvmExecutor(account, 'http://localhost:8545', 421614);
  assert.ok(clients.walletClient);
  assert.ok(clients.publicClient);
  assert.equal(typeof clients.walletClient.sendTransaction, 'function');
  assert.equal(typeof clients.publicClient.readContract, 'function');
});

// ---------------------------------------------------------------------------
// evmSign Tests
// ---------------------------------------------------------------------------

test('evmSign sends certificate to crossSignUrl and returns result', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';

  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await evmSign(MOCK_CERTIFICATE, CROSS_SIGN_URL);
  assert.equal(capturedUrl, CROSS_SIGN_URL);
  assert.deepEqual(result.transaction, MOCK_CROSS_SIGN_TX);
  assert.equal(result.signature, '0xsig');
});

test('evmSign throws FastError on cross-sign error response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: 'Invalid certificate' } });
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => evmSign(MOCK_CERTIFICATE, CROSS_SIGN_URL),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'TX_FAILED');
      assert.match((error as Error).message, /Cross-sign error/);
      return true;
    },
  );
});

test('evmSign throws FastError on HTTP error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Bad Request', { status: 400 });
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => evmSign(MOCK_CERTIFICATE, CROSS_SIGN_URL),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'TX_FAILED');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// executeDeposit Tests
// ---------------------------------------------------------------------------

test('executeDeposit sends approve + deposit transaction for ERC-20', async () => {
  let approveCallCount = 0;
  let sentTx: { to: string; data: string; value: string } | undefined;
  let approved = false;

  const mockClients = {
    walletClient: {
      account: { address: EVM_ADDRESS },
      sendTransaction: async (tx: { to: string; data: string; value: bigint }) => {
        sentTx = { to: tx.to, data: tx.data, value: tx.value.toString() };
        return TX_HASH;
      },
      writeContract: async () => {
        approveCallCount++;
        approved = true;
        return TX_HASH;
      },
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      readContract: async () => (approved ? 1_000_000n : 0n),
    },
  };

  const result = await executeDeposit({
    chainId: 421614,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS,
    amount: '1000000',
    receiverAddress: FAST_ADDRESS,
    evmClients: mockClients as any,
  });

  assert.equal(approveCallCount, 1);
  assert.equal(sentTx?.to, BRIDGE_CONTRACT);
  assert.equal(sentTx?.value, '0');
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.orderId, TX_HASH);
});

// Witness for the Arc gas-reserve guard: on Arc the deposited USDC is also the
// gas token, so executeDeposit must refuse balance == amount before any write.
function arcMockClients(balance: bigint) {
  const writes: string[] = [];
  let approved = false;
  const clients = {
    walletClient: {
      account: { address: EVM_ADDRESS },
      sendTransaction: async () => {
        writes.push('deposit');
        return TX_HASH;
      },
      writeContract: async () => {
        writes.push('approve');
        approved = true;
        return TX_HASH;
      },
    },
    publicClient: {
      chain: arc,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 0n }),
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'balanceOf') return balance;
        if (functionName === 'decimals') return 6;
        if (functionName === 'allowance') return approved ? 1_000_000n : 0n;
        throw new Error(`unexpected readContract ${functionName}`);
      },
    },
  };
  return { clients, writes };
}

const ARC_USDC = '0x3600000000000000000000000000000000000000';
// 20 gwei * 300k gas * 2 = 0.012 USDC = 12_000 units
const ARC_RESERVE_UNITS = 12_000n;

test('executeDeposit on Arc refuses balance == amount (gas comes from the same USDC) with zero writes', async () => {
  const { clients, writes } = arcMockClients(1_000_000n);
  await assert.rejects(
    executeDeposit({
      chainId: 5042,
      bridgeContract: BRIDGE_CONTRACT,
      tokenAddress: ARC_USDC,
      amount: '1000000',
      receiverAddress: FAST_ADDRESS,
      evmClients: clients as any,
    }),
    (err: unknown) => {
      assert.ok(err instanceof InsufficientBalanceError, `expected InsufficientBalanceError, got ${String(err)}`);
      assert.equal(err.balance, 1_000_000n);
      assert.equal(err.required, 1_000_000n + ARC_RESERVE_UNITS);
      assert.equal(err.tokenAddress, ARC_USDC);
      return true;
    },
  );
  assert.deepEqual(writes, []);
});

test('executeDeposit on Arc proceeds (approve then deposit) once balance covers amount + reserve', async () => {
  const { clients, writes } = arcMockClients(1_000_000n + ARC_RESERVE_UNITS);
  const result = await executeDeposit({
    chainId: 5042,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: ARC_USDC,
    amount: '1000000',
    receiverAddress: FAST_ADDRESS,
    evmClients: clients as any,
  });
  assert.deepEqual(writes, ['approve', 'deposit']);
  assert.equal(result.txHash, TX_HASH);
});

test('executeDeposit reserve guard does not apply to a non-gas token on Arc', async () => {
  const { clients, writes } = arcMockClients(1_000_000n);
  await executeDeposit({
    chainId: 5042,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS, // not the gas token
    amount: '1000000',
    receiverAddress: FAST_ADDRESS,
    evmClients: clients as any,
  });
  assert.deepEqual(writes, ['approve', 'deposit']);
});

test('executeDeposit always approves before depositing', async () => {
  let approveCallCount = 0;

  const mockClients = {
    walletClient: {
      account: { address: EVM_ADDRESS },
      sendTransaction: async () => TX_HASH,
      writeContract: async () => {
        approveCallCount++;
        return TX_HASH;
      },
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      readContract: async () => 2_000_000n,
    },
  };

  await executeDeposit({
    chainId: 421614,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS,
    amount: '1000000',
    receiverAddress: FAST_ADDRESS,
    evmClients: mockClients as any,
  });

  assert.equal(approveCallCount, 1);
});

test('executeDeposit throws FastError on reverted transaction', async () => {
  const mockClients = {
    walletClient: {
      account: { address: EVM_ADDRESS },
      sendTransaction: async () => TX_HASH,
      writeContract: async () => TX_HASH,
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'reverted' }),
      readContract: async () => 2_000_000n,
    },
  };

  await assert.rejects(
    () =>
      executeDeposit({
        chainId: 421614,
        bridgeContract: BRIDGE_CONTRACT,
        tokenAddress: TOKEN_ADDRESS,
        amount: '1000000',
        receiverAddress: FAST_ADDRESS,
        evmClients: mockClients as any,
      }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'TX_FAILED');
      return true;
    },
  );
});

test('executeDeposit throws FastError on invalid receiver address', async () => {
  const mockClients = {
    walletClient: { sendTransaction: async () => TX_HASH },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      readContract: async () => 0n,
    },
  };

  await assert.rejects(
    () =>
      executeDeposit({
        chainId: 421614,
        bridgeContract: BRIDGE_CONTRACT,
        tokenAddress: TOKEN_ADDRESS,
        amount: '1000000',
        receiverAddress: 'notavalidaddress',
        evmClients: mockClients as any,
      }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'INVALID_ADDRESS');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// executeIntent Tests
// ---------------------------------------------------------------------------

// Shared test signer/provider helpers
const TEST_PRIVATE_KEY = `0x${'55'.repeat(32)}`;
const testSigner = new Signer(TEST_PRIVATE_KEY);

function makeMockProvider(opts: { submitError?: Error } = {}): FastProvider {
  return {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      if (opts.submitError) throw opts.submitError;
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;
}

const BASE_INTENT_PARAMS = {
  fastBridgeAddress: FAST_BRIDGE_ADDRESS,
  relayerUrl: RELAY_URL,
  crossSignUrl: CROSS_SIGN_URL,
  tokenEvmAddress: TOKEN_ADDRESS,
  tokenFastTokenId: TOKEN_FAST_ID,
  amount: '1000000',
  networkId: 'fast:testnet',
} as const;

test('executeIntent performs 2 Fast submits + 2 cross-signs + 1 relayer call', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const submitCalls: unknown[] = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/relay')) return Response.json(RELAY_ACCEPTED);
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const mockProvider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submitCalls.push(envelope);
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  const result = await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    signer: testSigner,
    provider: mockProvider,
  });

  assert.equal(submitCalls.length, 2);
  assert.equal(urls.filter((u) => u === CROSS_SIGN_URL).length, 2);
  assert.equal(urls.filter((u) => u.includes('/relay')).length, 1);
  // txHash is derived from cross-sign bytes[32:64] = MOCK_CROSS_SIGN_TX[32:64] = TX_HASH
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.orderId, TX_HASH);
});

test('executeIntent rejects a transfer success certificate for another transaction before cross-signing', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) relayerCalls++;
    else crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  let failure: IndeterminateTransactionError | undefined;
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider: {
        getAccountInfo: async () => ({ nextNonce: 1n }) as any,
        submitTransaction: async (envelope: unknown) => {
          (envelope as any).transaction.value.nonce = 2n;
          const certificateEnvelope = structuredClone(envelope as object) as any;
          return { type: 'Success', value: { envelope: certificateEnvelope, signatures: [] } };
        },
      } as unknown as FastProvider,
    }),
    (candidate: unknown) => {
      failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
      return failure?.stage === 'transfer';
    },
  );

  assert.ok(failure);
  assert.equal(failure.mayHaveSettled, true);
  assert.equal(typeof failure.txHash, 'string');
  const transferRecovery = failure.recoveryEnvelope as any;
  assert.equal(transferRecovery.transaction.value.nonce, 1n);
  assert.equal(transferRecovery.transaction.value.networkId, 'fast:testnet');
  assert.equal(await hashRecoveryEnvelope(transferRecovery), failure.txHash);
  assert.equal(crossSignCalls, 0);
  assert.equal(relayerCalls, 0);
});

test('executeIntent rejects a transfer success certificate from another network', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  globalThis.fetch = async () => {
    crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  let failure: IndeterminateTransactionError | undefined;
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider: {
        getAccountInfo: async () => ({ nextNonce: 1n }) as any,
        submitTransaction: async (envelope: unknown) => {
          const certificateEnvelope = structuredClone(envelope as object) as any;
          certificateEnvelope.transaction.value.networkId = 'fast:mainnet';
          return { type: 'Success', value: { envelope: certificateEnvelope, signatures: [] } };
        },
      } as unknown as FastProvider,
    }),
    (candidate: unknown) => {
      failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
      return failure?.stage === 'transfer';
    },
  );

  assert.ok(failure);
  assert.equal(failure.mayHaveSettled, true);
  assert.equal(crossSignCalls, 0);
});

test('executeIntent rejects a malformed transfer success certificate before cross-signing', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  globalThis.fetch = async () => {
    crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  let failure: IndeterminateTransactionError | undefined;
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider: {
        getAccountInfo: async () => ({ nextNonce: 1n }) as any,
        submitTransaction: async () => ({ type: 'Success', value: { envelope: { transaction: null }, signatures: [] } }),
      } as unknown as FastProvider,
    }),
    (candidate: unknown) => {
      failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
      return failure?.stage === 'transfer';
    },
  );

  assert.ok(failure);
  assert.equal(failure.mayHaveSettled, true);
  assert.equal(crossSignCalls, 0);
});

test('executeIntent preserves transfer recovery when FastProvider decodes malformed 2xx', async () => {
  const originalFetch = globalThis.fetch;
  let submitCalls = 0;
  let crossSignCalls = 0;
  let relayerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v1/submit-transaction')) submitCalls++;
    else if (String(url).includes('/relay')) relayerCalls++;
    else crossSignCalls++;
    return Response.json({ data: { malformed: true }, meta: { timestamp: new Date().toISOString() } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const realProvider = new FastProvider({ url: 'https://proxy.invalid', networkId: 'fast:testnet' });
  let failure: IndeterminateTransactionError | undefined;
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider: {
        getAccountInfo: async () => ({ nextNonce: 1n }) as any,
        submitTransaction: realProvider.submitTransaction.bind(realProvider),
      } as unknown as FastProvider,
    }),
    (candidate: unknown) => {
      failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
      return failure?.stage === 'transfer';
    },
  );

  assert.ok(failure);
  assert.equal(failure.mayHaveSettled, true);
  assert.equal(typeof failure.txHash, 'string');
  assert.equal(await hashRecoveryEnvelope(failure.recoveryEnvelope), failure.txHash);
  assert.equal(submitCalls, 1);
  assert.equal(crossSignCalls, 0);
  assert.equal(relayerCalls, 0);
});

const INCOMPLETE_SUBMISSION_RESULTS = [
  { label: 'incomplete verifier signatures', result: { type: 'IncompleteVerifierSigs', value: null } },
  { label: 'incomplete multisig', result: { type: 'IncompleteMultiSig', value: null } },
] as const;

for (const { label, result } of INCOMPLETE_SUBMISSION_RESULTS) {
  test(`executeIntent preserves transfer recovery for ${label}`, async () => {
    const originalFetch = globalThis.fetch;
    let crossSignCalls = 0;
    let relayerCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/relay')) relayerCalls++;
      else crossSignCalls++;
      return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
    };
    onTestFinished(() => {
      globalThis.fetch = originalFetch;
    });

    let failure: IndeterminateTransactionError | undefined;
    await assert.rejects(
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
        signer: testSigner,
        provider: {
          getAccountInfo: async () => ({ nextNonce: 1n }) as any,
          submitTransaction: async () => result as any,
        } as unknown as FastProvider,
      }),
      (candidate: unknown) => {
        failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
        return failure?.stage === 'transfer';
      },
    );

    assert.ok(failure);
    assert.equal(failure.mayHaveSettled, true);
    assert.equal(typeof failure.txHash, 'string');
    assert.equal(await hashRecoveryEnvelope(failure.recoveryEnvelope), failure.txHash);
    assert.doesNotMatch(failure.message, /Try again/);
    assert.doesNotMatch(failure.note, /try again/i);
    assert.equal(crossSignCalls, 0);
    assert.equal(relayerCalls, 0);
  });
}

test('executeIntent rejects an intent success certificate for another transaction before relaying', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) relayerCalls++;
    else crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  let submitCalls = 0;
  let failure: IndeterminateTransactionError | undefined;
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider: {
        getAccountInfo: async () => ({ nextNonce: 1n }) as any,
        submitTransaction: async (envelope: unknown) => {
          submitCalls++;
          const certificateEnvelope = structuredClone(envelope as object) as any;
          if (submitCalls === 2) {
            (envelope as any).transaction.value.nonce = 2n;
            certificateEnvelope.transaction.value.nonce = 2n;
          }
          return { type: 'Success', value: { envelope: certificateEnvelope, signatures: [] } };
        },
      } as unknown as FastProvider,
    }),
    (candidate: unknown) => {
      failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
      return failure?.stage === 'intent';
    },
  );

  assert.ok(failure);
  assert.equal(failure.mayHaveSettled, true);
  assert.equal(typeof failure.relatedTxHash, 'string');
  const intentRecovery = failure.recoveryEnvelope as any;
  assert.equal(intentRecovery.transaction.value.nonce, 1n);
  assert.equal(intentRecovery.transaction.value.networkId, 'fast:testnet');
  assert.equal(await hashRecoveryEnvelope(intentRecovery), failure.txHash);
  assert.equal(submitCalls, 2);
  assert.equal(crossSignCalls, 1);
  assert.equal(relayerCalls, 0);
});

test('executeIntent preserves intent recovery when FastProvider decodes malformed 2xx', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/v1/submit-transaction')) {
      return Response.json({ data: { malformed: true }, meta: { timestamp: new Date().toISOString() } });
    }
    if (String(url).includes('/relay')) {
      relayerCalls++;
      return Response.json(RELAY_ACCEPTED);
    }
    crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const realProvider = new FastProvider({ url: 'https://proxy.invalid', networkId: 'fast:testnet' });
  let submitCalls = 0;
  let failure: IndeterminateTransactionError | undefined;
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider: {
        getAccountInfo: async () => ({ nextNonce: 1n }) as any,
        submitTransaction: async (envelope: unknown) => {
          submitCalls++;
          if (submitCalls === 1) return { type: 'Success', value: { envelope, signatures: [] } };
          return realProvider.submitTransaction(envelope as any);
        },
      } as unknown as FastProvider,
    }),
    (candidate: unknown) => {
      failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
      return failure?.stage === 'intent';
    },
  );

  assert.ok(failure);
  assert.equal(failure.mayHaveSettled, true);
  assert.equal(typeof failure.txHash, 'string');
  assert.equal(typeof failure.relatedTxHash, 'string');
  assert.equal(await hashRecoveryEnvelope(failure.recoveryEnvelope), failure.txHash);
  assert.equal(submitCalls, 2);
  assert.equal(crossSignCalls, 1);
  assert.equal(relayerCalls, 0);
});

for (const { label, result } of INCOMPLETE_SUBMISSION_RESULTS) {
  test(`executeIntent preserves intent recovery for ${label}`, async () => {
    const originalFetch = globalThis.fetch;
    let crossSignCalls = 0;
    let relayerCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/relay')) {
        relayerCalls++;
        return Response.json(RELAY_ACCEPTED);
      }
      crossSignCalls++;
      return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
    };
    onTestFinished(() => {
      globalThis.fetch = originalFetch;
    });

    let submitCalls = 0;
    let transferHash: string | undefined;
    let failure: IndeterminateTransactionError | undefined;
    await assert.rejects(
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
        signer: testSigner,
        provider: {
          getAccountInfo: async () => ({ nextNonce: 1n }) as any,
          submitTransaction: async (envelope: unknown) => {
            submitCalls++;
            if (submitCalls === 1) {
              const submittedEnvelope = structuredClone(envelope as object) as any;
              transferHash = await hashRecoveryEnvelope(submittedEnvelope);
              return { type: 'Success', value: { envelope: submittedEnvelope, signatures: [] } };
            }
            return result as any;
          },
        } as unknown as FastProvider,
      }),
      (candidate: unknown) => {
        failure = candidate instanceof IndeterminateTransactionError ? candidate : undefined;
        return failure?.stage === 'intent';
      },
    );

    assert.ok(failure);
    assert.ok(transferHash);
    assert.equal(failure.mayHaveSettled, true);
    assert.equal(typeof failure.txHash, 'string');
    assert.equal(failure.relatedTxHash, transferHash);
    assert.equal(await hashRecoveryEnvelope(failure.recoveryEnvelope), failure.txHash);
    assert.doesNotMatch(failure.message, /Try again/);
    assert.doesNotMatch(failure.note, /try again/i);
    assert.equal(submitCalls, 2);
    assert.equal(crossSignCalls, 1);
    assert.equal(relayerCalls, 0);
  });
}

test('legacy deadlines are added exactly without number rounding', async () => {
  const originalNow = Date.now;
  Date.now = () => 1700000000000;
  onTestFinished(() => {
    Date.now = originalNow;
  });
  const submitted: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('/relay')
      ? Response.json(RELAY_ACCEPTED)
      : Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const deadlineSeconds = Number.MAX_SAFE_INTEGER;
  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    deadlineSeconds,
    signer: testSigner,
    provider: {
      getAccountInfo: async () => ({ nextNonce: 1n }) as any,
      submitTransaction: async (envelope: unknown) => {
        submitted.push(envelope);
        return { type: 'Success', value: { envelope, signatures: [] } };
      },
    } as unknown as FastProvider,
  });

  const claimData = (((submitted[1] as any).transaction.value.claims?.[0] ?? (submitted[1] as any).transaction.value.claim).value.claim.claimData) as Uint8Array;
  const expected = hexToBytes(
    encodeIntentClaim({
      transferFastTxId: TX_HASH,
      deadline: BigInt(Math.floor(1700000000000 / 1000)) + BigInt(deadlineSeconds),
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    }),
  );
  assert.deepEqual(Array.from(claimData), Array.from(expected));
});

test('executeIntent uses fastBridgeAddress as recipient in TokenTransfer', async () => {
  const originalFetch = globalThis.fetch;
  const submitCalls: unknown[] = [];

  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) return Response.json(RELAY_ACCEPTED);
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const mockProvider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submitCalls.push(envelope);
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    signer: testSigner,
    provider: mockProvider,
  });

  // First submit is a TokenTransfer — verify the recipient in the signed envelope
  const envelope = submitCalls[0] as any;
  const tx = envelope.transaction.value; // VersionedTransaction.value = Transaction
  // Release20260407 uses `claims` (array) instead of `claim`
  const claim = tx.claims?.[0] ?? tx.claim;
  assert.equal(claim.type, 'TokenTransfer');
  const expectedRecipient = Array.from(fastAddressToBytes(FAST_BRIDGE_ADDRESS));
  assert.deepEqual(Array.from(claim.value.recipient as Uint8Array), expectedRecipient);
});

test('executeIntent sends correct relayer payload', async () => {
  const originalFetch = globalThis.fetch;
  let relayerBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/relay')) {
      relayerBody = JSON.parse(String(init?.body));
      return Response.json(RELAY_ACCEPTED);
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    signer: testSigner,
    provider: makeMockProvider(),
  });

  const expectedFastAddress = await testSigner.getFastAddress();
  assert.equal(relayerBody?.fastset_address, expectedFastAddress);
  assert.equal(relayerBody?.external_address, EVM_ADDRESS);
  assert.equal(relayerBody?.external_token_address, TOKEN_ADDRESS);
});

test('executeIntent infers external_address from Execute intent target', async () => {
  const originalFetch = globalThis.fetch;
  const contractAddress = '0x1111111111111111111111111111111111111111';
  let relayerBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/relay')) {
      relayerBody = JSON.parse(String(init?.body));
      return Response.json(RELAY_ACCEPTED);
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents: [buildExecuteIntent(contractAddress, '0xabcdef')],
    signer: testSigner,
    provider: makeMockProvider(),
  });

  assert.equal(relayerBody?.external_address, contractAddress);
});

test('executeIntent throws FastError when no external address can be resolved', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  let signerCalls = 0;
  let accountInfoCalls = 0;
  let submitCalls = 0;
  const signer = {
    getPublicKey: async () => {
      signerCalls++;
      throw new Error('signer touched before externalAddress preflight');
    },
    getFastAddress: async () => {
      signerCalls++;
      throw new Error('signer touched before externalAddress preflight');
    },
  } as any;
  const provider = {
    getAccountInfo: async () => {
      accountInfoCalls++;
      return { nextNonce: 1n };
    },
    submitTransaction: async () => {
      submitCalls++;
      return { type: 'Success', value: { envelope: {}, signatures: [] } };
    },
  } as unknown as FastProvider;

  await assert.rejects(
    () =>
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [buildRevokeIntent()],
        signer,
        provider,
      }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'INVALID_PARAMS');
      return true;
    },
  );

  assert.equal(signerCalls, 0);
  assert.equal(accountInfoCalls, 0);
  assert.equal(submitCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('executeIntent throws FastError when intents array is empty', async () => {
  await assert.rejects(
    () =>
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [],
        signer: testSigner,
        provider: makeMockProvider(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'INVALID_PARAMS');
      return true;
    },
  );
});

test('executeIntent preserves definitive provider rejection', async () => {
  const upstreamError = new InvalidRequestError({ message: 'request rejected before submission' });

  await assert.rejects(
    () =>
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
        signer: testSigner,
        provider: makeMockProvider({ submitError: upstreamError }),
      }),
    (error: unknown) => {
      assert.equal(error, upstreamError);
      return true;
    },
  );
});

test('executeIntent preserves recovery identity on relayer failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) return new Response('internal error', { status: 500 });
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const submissions: unknown[] = [];
  const provider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submissions.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  let failure: unknown;
  try {
    await executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof FastError);
  assert.ok(failure instanceof PostPaymentRecoveryError);
  assert.equal((failure as FastError).code, 'POST_PAYMENT_INCOMPLETE');
  const recovery = failure as FastError & {
    stage: string;
    relayOutcome: string;
    transfer: { txHash: string; recoveryEnvelope: unknown };
    intent: { txHash: string; recoveryEnvelope: unknown };
  };
  assert.equal(recovery.stage, 'relay');
  assert.equal(recovery.relayOutcome, 'unknown');
  assert.equal(submissions.length, 2);
  assert.equal(recovery.transfer.txHash, await hashRecoveryEnvelope(submissions[0]));
  assert.equal(recovery.intent.txHash, await hashRecoveryEnvelope(submissions[1]));
  assert.deepEqual(recovery.transfer.recoveryEnvelope, submissions[0]);
  assert.deepEqual(recovery.intent.recoveryEnvelope, submissions[1]);
  const serialized = JSON.parse(JSON.stringify(failure)) as {
    stage: string;
    relayOutcome: string;
    transfer: { txHash: string; recoveryEnvelope: unknown };
    intent: { txHash: string; recoveryEnvelope: unknown };
  };
  assert.equal(serialized.stage, 'relay');
  assert.equal(serialized.relayOutcome, 'unknown');
  assert.equal(serialized.transfer.txHash, recovery.transfer.txHash);
  assert.equal(serialized.intent.txHash, recovery.intent.txHash);
  assert.equal(
    await hashRecoveryEnvelope({
      transaction: restoreJsonSafeBytes((serialized.transfer.recoveryEnvelope as any).transaction),
    }),
    recovery.transfer.txHash,
  );
  assert.equal(
    await hashRecoveryEnvelope({
      transaction: restoreJsonSafeBytes((serialized.intent.recoveryEnvelope as any).transaction),
    }),
    recovery.intent.txHash,
  );
  assert.match((failure as Error).message, /Do not retry executeIntent/i);
});

test('relayExecute does not treat a malformed HTTP 200 body as accepted', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true });
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const result: RelayResult = await relayExecute({
    relayerUrl: RELAY_URL,
    encodedTransferClaim: [1],
    transferProof: '0xsig',
    transferFastTxId: TX_HASH,
    fastsetAddress: FAST_ADDRESS,
    externalAddress: EVM_ADDRESS,
  });
  assert.deepEqual(result, { success: false, outcome: 'unknown' });
});

test('executeIntent preserves transfer recovery when the second account read fails', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) {
      relayCalls++;
      return Response.json(RELAY_ACCEPTED);
    }
    crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const accountReadError = new Error('second account read failed');
  let accountInfoCalls = 0;
  const submissions: unknown[] = [];
  const provider = {
    getAccountInfo: async () => {
      accountInfoCalls++;
      if (accountInfoCalls === 2) throw accountReadError;
      return { nextNonce: 1n };
    },
    submitTransaction: async (envelope: unknown) => {
      submissions.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  let failure: unknown;
  try {
    await executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof PostPaymentRecoveryError);
  const recovery = failure as PostPaymentRecoveryError;
  assert.equal(recovery.stage, 'intent-account-info');
  assert.equal(recovery.cause, accountReadError);
  assert.equal(recovery.transfer.txHash, await hashRecoveryEnvelope(submissions[0]));
  assert.deepEqual(recovery.transfer.recoveryEnvelope, submissions[0]);
  assert.equal(recovery.intent, undefined);
  assert.equal(accountInfoCalls, 2);
  assert.equal(submissions.length, 1);
  assert.equal(crossSignCalls, 1);
  assert.equal(relayCalls, 0);
});

test('executeIntent preserves the settled transfer identity when cross-sign fails', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) {
      relayCalls++;
      return Response.json(RELAY_ACCEPTED);
    }
    crossSignCalls++;
    return Response.json({ error: { message: 'cross-sign unavailable' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const submissions: unknown[] = [];
  const provider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submissions.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  let failure: unknown;
  try {
    await executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof FastError);
  assert.ok(failure instanceof PostPaymentRecoveryError);
  assert.equal((failure as FastError).code, 'POST_PAYMENT_INCOMPLETE');
  const recovery = failure as FastError & {
    stage: string;
    transfer: { txHash: string; recoveryEnvelope: unknown };
    intent?: unknown;
  };
  assert.equal(recovery.stage, 'transfer-cross-sign');
  assert.equal(recovery.transfer.txHash, await hashRecoveryEnvelope(submissions[0]));
  assert.deepEqual(recovery.transfer.recoveryEnvelope, submissions[0]);
  assert.equal(recovery.intent, undefined);
  assert.equal(crossSignCalls, 1);
  assert.equal(submissions.length, 1);
  assert.equal(relayCalls, 0);
});

test('executeIntent preserves transfer recovery when cross-sign returns a malformed transaction ID', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) {
      relayCalls++;
      return Response.json(RELAY_ACCEPTED);
    }
    crossSignCalls++;
    return Response.json({ result: { transaction: [], signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const submissions: unknown[] = [];
  const provider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submissions.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  let failure: unknown;
  try {
    await executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider,
      claimEncoding: 'v1',
      chainId: 5042,
      bridgeContract: BRIDGE_CONTRACT,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof PostPaymentRecoveryError);
  const recovery = failure as PostPaymentRecoveryError;
  assert.equal(recovery.stage, 'transfer-cross-sign');
  assert.equal(recovery.transfer.txHash, await hashRecoveryEnvelope(submissions[0]));
  assert.deepEqual(recovery.transfer.recoveryEnvelope, submissions[0]);
  assert.equal(recovery.intent, undefined);
  assert.equal(submissions.length, 1, 'no intent transaction may be submitted');
  assert.equal(crossSignCalls, 1);
  assert.equal(relayCalls, 0);
});

test('executeIntent preserves both settled identities when intent cross-sign fails', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) {
      relayCalls++;
      return Response.json(RELAY_ACCEPTED);
    }
    if (crossSignCalls++ === 0) {
      return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
    }
    return Response.json({ error: { message: 'intent cross-sign unavailable' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const submissions: unknown[] = [];
  const provider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submissions.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  let failure: unknown;
  try {
    await executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof FastError);
  assert.ok(failure instanceof PostPaymentRecoveryError);
  assert.equal((failure as FastError).code, 'POST_PAYMENT_INCOMPLETE');
  const recovery = failure as FastError & {
    stage: string;
    transfer: { txHash: string; recoveryEnvelope: unknown };
    intent: { txHash: string; recoveryEnvelope: unknown };
  };
  assert.equal(recovery.stage, 'intent-cross-sign');
  assert.equal(recovery.transfer.txHash, await hashRecoveryEnvelope(submissions[0]));
  assert.equal(recovery.intent.txHash, await hashRecoveryEnvelope(submissions[1]));
  assert.deepEqual(recovery.transfer.recoveryEnvelope, submissions[0]);
  assert.deepEqual(recovery.intent.recoveryEnvelope, submissions[1]);
  assert.equal(crossSignCalls, 2);
  assert.equal(submissions.length, 2);
  assert.equal(relayCalls, 0);
});

test('executeIntent rejects a relayer success:false acknowledgement without losing recovery identity', async () => {
  const originalFetch = globalThis.fetch;
  let crossSignCalls = 0;
  let relayCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) {
      relayCalls++;
      return Response.json({ success: false, message: 'Failed to persist task', block_number: null, job_id: 'test-job' });
    }
    crossSignCalls++;
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const submissions: unknown[] = [];
  const provider = {
    getAccountInfo: async () => ({ nextNonce: 1n }) as any,
    submitTransaction: async (envelope: unknown) => {
      submissions.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  let failure: unknown;
  try {
    await executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer: testSigner,
      provider,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof FastError);
  assert.ok(failure instanceof PostPaymentRecoveryError);
  assert.equal((failure as FastError).code, 'POST_PAYMENT_INCOMPLETE');
  const recovery = failure as FastError & {
    stage: string;
    relayOutcome: string;
    transfer: { txHash: string; recoveryEnvelope: unknown };
    intent: { txHash: string; recoveryEnvelope: unknown };
  };
  assert.equal(recovery.stage, 'relay');
  assert.equal(recovery.relayOutcome, 'rejected');
  assert.equal(recovery.transfer.txHash, await hashRecoveryEnvelope(submissions[0]));
  assert.equal(recovery.intent.txHash, await hashRecoveryEnvelope(submissions[1]));
  assert.deepEqual(recovery.transfer.recoveryEnvelope, submissions[0]);
  assert.deepEqual(recovery.intent.recoveryEnvelope, submissions[1]);
  assert.equal(crossSignCalls, 2);
  assert.equal(relayCalls, 1);
});

/** Wrap the real signer so the test observes the actual Signer API used by TransactionBuilder. */
function spyOnSigner(touched: string[], beforeGetPublicKey?: () => void): Signer {
  return new Proxy(testSigner, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        touched.push(String(key));
        if (key === 'getPublicKey') beforeGetPublicKey?.();
        return value.apply(target, args);
      };
    },
  });
}

function spyOnProvider(touched: string[], submitted: unknown[]): FastProvider {
  return {
    getAccountInfo: async () => {
      touched.push('getAccountInfo');
      return { nextNonce: 1n } as any;
    },
    submitTransaction: async (envelope: unknown) => {
      touched.push('submitTransaction');
      submitted.push(envelope);
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;
}

const crossSignFetch = async (url: RequestInfo | URL) =>
  String(url).includes('/relay') ? Response.json(RELAY_ACCEPTED) : Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });

function submittedClaim(submitted: unknown[], index: number): any {
  const tx = (submitted[index] as any).transaction.value;
  return tx.claims?.[0] ?? tx.claim;
}

test('executeIntent with claimEncoding v1 validates before touching the signer or the provider', async () => {
  const touched: string[] = [];
  const submitted: unknown[] = [];
  const signer = spyOnSigner(touched);
  const provider = spyOnProvider(touched, submitted);
  const base = {
    ...BASE_INTENT_PARAMS,
    signer,
    provider,
    claimEncoding: 'v1' as const,
    chainId: 5042,
    bridgeContract: BRIDGE_CONTRACT,
  };
  const transfer = [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)];

  await assert.rejects(executeIntent({ ...BASE_INTENT_PARAMS, signer, provider, intents: transfer, deadlineSeconds: 0.5 }), /deadlineSeconds/);
  await assert.rejects(executeIntent({ ...base, intents: transfer, bridgeContract: undefined }), /bridgeContract/);
  await assert.rejects(executeIntent({ ...base, intents: [{ ...buildRevokeIntent(), value: 1n }] }), /revoke/);
  await assert.rejects(executeIntent({ ...base, intents: [buildRevokeIntent()] }), /externalAddress/);
  for (const bad of [0.5, 0, Infinity, 1e30]) {
    await assert.rejects(executeIntent({ ...base, intents: transfer, deadlineSeconds: bad }), /deadlineSeconds/);
  }
  const huge = buildExecuteIntent(TOKEN_ADDRESS, `0x${'00'.repeat(2100)}`);
  await assert.rejects(executeIntent({ ...base, intents: [huge] }), /4096/);

  assert.deepEqual(touched, [], 'every rejection above must happen before any signer or provider call');
  assert.equal(submitted.length, 0);
});

test('executeIntent rejects a malformed externalAddress before touching the signer or provider', async () => {
  const touched: string[] = [];
  const submitted: unknown[] = [];
  const signer = spyOnSigner(touched, () => {
    throw new Error('signer touched before externalAddress was rejected');
  });

  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      externalAddress: '0x1234',
      signer,
      provider: spyOnProvider(touched, submitted),
      claimEncoding: 'v1',
      chainId: 5042,
      bridgeContract: BRIDGE_CONTRACT,
    }),
    /externalAddress.*20-byte/,
  );
  assert.deepEqual(touched, []);
  assert.equal(submitted.length, 0);
});

test('executeIntent with claimEncoding v1 rejects fractional intent values before touching the signer or provider', async () => {
  const touched: string[] = [];
  const submitted: unknown[] = [];
  const signer = spyOnSigner(touched, () => {
    throw new Error('signer touched before fractional intent value was rejected');
  });

  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [{ ...buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS), value: 0.5 as unknown as bigint }],
      signer,
      provider: spyOnProvider(touched, submitted),
      claimEncoding: 'v1',
      chainId: 5042,
      bridgeContract: BRIDGE_CONTRACT,
    }),
    /value.*bigint/,
  );
  assert.deepEqual(touched, []);
  assert.equal(submitted.length, 0);
});

test('executeIntent with claimEncoding v1 rejects sparse intents before touching the signer or provider', async () => {
  const touched: string[] = [];
  const submitted: unknown[] = [];
  const intents = [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)];
  intents.length = 2;
  const signer = spyOnSigner(touched, () => {
    throw new Error('signer touched before sparse intents were rejected');
  });

  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents,
      signer,
      provider: spyOnProvider(touched, submitted),
      claimEncoding: 'v1',
      chainId: 5042,
      bridgeContract: BRIDGE_CONTRACT,
    }),
    /intents\[1\].*missing/,
  );
  assert.deepEqual(touched, []);
  assert.equal(submitted.length, 0);
});

test('executeIntent with claimEncoding v1 rejects revoke batches before touching the signer or provider', async () => {
  for (const intents of [
    [buildRevokeIntent(), buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS), buildRevokeIntent()],
    [buildRevokeIntent(), buildRevokeIntent()],
  ]) {
    const touched: string[] = [];
    const submitted: unknown[] = [];
    const signer = spyOnSigner(touched, () => {
      throw new Error('signer touched before revoke batch was rejected');
    });

    await assert.rejects(
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents,
        externalAddress: EVM_ADDRESS,
        signer,
        provider: spyOnProvider(touched, submitted),
        claimEncoding: 'v1',
        chainId: 5042,
        bridgeContract: BRIDGE_CONTRACT,
      }),
      /revoke.*sole intent/,
    );
    assert.deepEqual(touched, []);
    assert.equal(submitted.length, 0);
  }
});

test('executeIntent rejects an unknown runtime claimEncoding before touching the signer or provider', async () => {
  const touched: string[] = [];
  const submitted: unknown[] = [];
  const signer = spyOnSigner(touched, () => {
    throw new Error('signer touched before claimEncoding was rejected');
  });

  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer,
      provider: spyOnProvider(touched, submitted),
      claimEncoding: 'v2' as 'v1',
    }),
    /claimEncoding/,
  );
  await assert.rejects(
    executeIntent({
      ...BASE_INTENT_PARAMS,
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      signer,
      provider: spyOnProvider(touched, submitted),
      claimEncoding: null as unknown as 'v1',
    }),
    /claimEncoding/,
  );
  assert.deepEqual(touched, []);
  assert.equal(submitted.length, 0);
});

test('executeIntent with claimEncoding v1 sends the tag on the transfer and decodable JSON in the claim', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = crossSignFetch;
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });
  const touched: string[] = [];
  const submitted: unknown[] = [];

  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    signer: spyOnSigner(touched),
    provider: spyOnProvider(touched, submitted),
    claimEncoding: 'v1',
    chainId: 5042,
    bridgeContract: BRIDGE_CONTRACT,
    display: { amount: 1000000n, tokenSymbol: 'USDC', tokenDecimals: 6 },
  });

  assert.equal(submitted.length, 2);
  const transfer = submittedClaim(submitted, 0);
  assert.equal(transfer.type, 'TokenTransfer');
  assert.deepEqual(Array.from(transfer.value.userData as Uint8Array), Array.from(transferUserDataTag(5042)));
  const external = submittedClaim(submitted, 1);
  assert.equal(external.type, 'ExternalClaim');
  const decoded = decodeIntentClaimV1(external.value.claim.claimData as Uint8Array);
  assert.equal(decoded.chain, 'eip155:5042');
  assert.equal(decoded.bridge, BRIDGE_CONTRACT.toLowerCase());
  assert.equal(decoded.kind, 'withdraw');
  assert.equal(decoded.display?.tokenSymbol, 'USDC');
});

test('executeIntent with claimEncoding v1 is immune to caller mutation during the async legs', async () => {
  const originalFetch = globalThis.fetch;
  let relayerBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/relay')) {
      relayerBody = JSON.parse(String(init?.body));
      return Response.json(RELAY_ACCEPTED);
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });
  const touched: string[] = [];
  const submitted: unknown[] = [];
  const display = { amount: 1000000n, tokenSymbol: 'USDC', tokenDecimals: 6 };
  const intents = [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)];
  const signer = spyOnSigner(touched, () => {
    display.tokenSymbol = 'é'.repeat(9);
    display.tokenDecimals = 99;
    intents[0] = buildTransferIntent(TOKEN_ADDRESS, '0x2222222222222222222222222222222222222222');
  });

  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents,
    signer,
    provider: spyOnProvider(touched, submitted),
    claimEncoding: 'v1',
    chainId: 5042,
    bridgeContract: BRIDGE_CONTRACT,
    display,
  });

  assert.ok(touched.includes('getPublicKey'));
  assert.equal(submitted.length, 2);
  const decoded = decodeIntentClaimV1(submittedClaim(submitted, 1).value.claim.claimData as Uint8Array);
  assert.equal(decoded.display?.tokenSymbol, 'USDC');
  assert.equal(decoded.display?.tokenDecimals, 6);
  assert.equal(decoded.intents[0]?.action, 'transfer');
  if (decoded.intents[0]?.action === 'transfer') {
    assert.equal(decoded.intents[0].receiver, EVM_ADDRESS);
  }
  assert.equal(relayerBody?.external_address, EVM_ADDRESS);
});

test('executeIntent legacy claim and relayer metadata use the same pre-await intent snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let relayerBody: Record<string, unknown> | undefined;
  Date.now = () => 1700000000000;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/relay')) {
      relayerBody = JSON.parse(String(init?.body));
      return Response.json(RELAY_ACCEPTED);
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  });

  const originalIntent = buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS);
  const mutatedIntent = buildTransferIntent(TOKEN_ADDRESS, '0x2222222222222222222222222222222222222222');
  const intents = [originalIntent];
  const submitted: unknown[] = [];
  let accountInfoCalls = 0;
  const provider = {
    getAccountInfo: async () => {
      if (accountInfoCalls++ === 0) intents[0] = mutatedIntent;
      return { nextNonce: 1n } as any;
    },
    submitTransaction: async (envelope: unknown) => {
      submitted.push(structuredClone(envelope));
      return { type: 'Success', value: { envelope, signatures: [] } };
    },
  } as unknown as FastProvider;

  await executeIntent({
    ...BASE_INTENT_PARAMS,
    intents,
    signer: testSigner,
    provider,
  });

  assert.equal(submitted.length, 2);
  const claimData = ((submitted[1] as any).transaction.value.claims?.[0] ?? (submitted[1] as any).transaction.value.claim).value.claim
    .claimData as Uint8Array;
  const expected = hexToBytes(
    encodeIntentClaim({
      transferFastTxId: TX_HASH,
      deadline: BigInt(Math.floor(1700000000000 / 1000)) + 3600n,
      intents: [originalIntent],
    }),
  );
  assert.deepEqual(Array.from(claimData), Array.from(expected));
  assert.equal(relayerBody?.external_address, EVM_ADDRESS);
  assert.equal(accountInfoCalls, 2);
});

// ---------------------------------------------------------------------------
// executeWithdraw Tests
// ---------------------------------------------------------------------------

test('executeWithdraw calls executeIntent with a DynamicTransfer intent', async () => {
  const originalFetch = globalThis.fetch;
  let relayerBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/relay')) {
      relayerBody = JSON.parse(String(init?.body));
      return Response.json(RELAY_ACCEPTED);
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeWithdraw({
    ...BASE_INTENT_PARAMS,
    receiverEvmAddress: EVM_ADDRESS,
    signer: testSigner,
    provider: makeMockProvider(),
  });

  assert.equal(relayerBody?.external_address, EVM_ADDRESS);
  assert.equal(relayerBody?.external_token_address, TOKEN_ADDRESS);
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.orderId, TX_HASH);
});

// ---------------------------------------------------------------------------
// smartDeposit (EIP-7702) Tests
// ---------------------------------------------------------------------------

test('smartDeposit is exported from index', () => {
  assert.equal(typeof smartDeposit, 'function');
  assert.equal(typeof InsufficientBalanceError, 'function');
});

test('smartDeposit throws InsufficientBalanceError when balance is below amount', async () => {
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => smartDeposit({
      privateKey: PRIVATE_KEY,
      rpcUrl: 'https://mainnet.base.org',
      allsetApiUrl: 'http://localhost:9999',
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: 1_000_000n,
      bridgeAddress: '0x8677EdAA374b7A47ff0093947AABE4aCbB2D4538',
      depositCalldata: '0xdeadbeef',
    }),
    (err: unknown) => {
      assert.ok(err instanceof InsufficientBalanceError, `expected InsufficientBalanceError, got ${err}`);
      return true;
    },
  );
});

test('smartDeposit rejects with prepare error when backend returns 500', async () => {
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes('/userop/prepare')) {
      return new Response(JSON.stringify({ error: 'backend offline' }), { status: 500 });
    }
    // 10 USDC balance
    return Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: '0x0000000000000000000000000000000000000000000000000000000000989680',
    });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => smartDeposit({
      privateKey: PRIVATE_KEY,
      rpcUrl: 'https://mainnet.base.org',
      allsetApiUrl: 'http://localhost:9999',
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: 1_000_000n,
      bridgeAddress: '0x8677EdAA374b7A47ff0093947AABE4aCbB2D4538',
      depositCalldata: '0xdeadbeef',
    }),
    (err: unknown) => {
      assert.match(String(err), /failed/i);
      return true;
    },
  );
});
