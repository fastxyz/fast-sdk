import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { FastError } from '../src/errors.ts';
import { encodeFunctionData } from 'viem';

import {
  // address
  fastAddressToBytes32,
  fastAddressToBytes,
  // deposit
  buildDepositTransaction,
  encodeDepositCalldata,
  // intents
  IntentAction,
  buildTransferIntent,
  buildExecuteIntent,
  buildDepositBackIntent,
  buildRevokeIntent,
  // evm-executor
  createEvmWallet,
  createEvmExecutor,
  // bridge
  evmSign,
  executeDeposit,
  executeIntent,
} from '../src/index.ts';

const FAST_ADDRESS = 'fast1rsxfj84yhsskpr6g5ll2td7pkk3dnlsfwldsmawca4922qn3dqvqsxelzv';
const EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
const TX_HASH = `0x${'11'.repeat(32)}`;
const BRIDGE_CONTRACT = '0xb53600976275D6f541a3B929328d07714EFA581F' as `0x${string}`;
const TOKEN_ADDRESS = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as `0x${string}`;
const FAST_BRIDGE_ADDRESS = 'fast1tkmtqxulhnzeeg9zhuwxy3x95wr7waytm9cq40ndf7tkuwwcc6jseg24j8';
const RELAY_URL = 'https://testnet.allset.fast.xyz/arbitrum-sepolia/relayer';
const CROSS_SIGN_URL = 'https://testnet.cross-sign.allset.fast.xyz';
const TOKEN_FAST_ID = 'd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46';

const MOCK_CROSS_SIGN_TX = [
  ...Array(32).fill(0),
  ...Array(32).fill(0x11),
];

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
  assert.equal(typeof evmSign, 'function');
});

test('removed APIs are no longer exported', async () => {
  const mod = await import('../src/index.ts') as Record<string, unknown>;
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
  assert.equal(
    fastAddressToBytes32(FAST_ADDRESS),
    '0x1c0c991ea4bc21608f48a7fea5b7c1b5a2d9fe0977db0df5d8ed4aa502716818',
  );
});

test('fastAddressToBytes32 rejects invalid Fast addresses', () => {
  assert.throws(
    () => fastAddressToBytes32('fast1invalid'),
    /Invalid Fast address "fast1invalid"/,
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
    abi: [{
      type: 'function' as const,
      name: 'deposit' as const,
      inputs: [
        { name: 'token', type: 'address' as const },
        { name: 'amount', type: 'uint256' as const },
        { name: 'receiver', type: 'bytes32' as const },
      ],
      outputs: [],
      stateMutability: 'payable' as const,
    }],
    functionName: 'deposit',
    args: [TOKEN_ADDRESS, 1_000_000n, receiverBytes32],
  });

  assert.equal(
    encodeDepositCalldata({ tokenAddress: TOKEN_ADDRESS, amount: 1_000_000n, receiverBytes32 }),
    expected,
  );
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
    () => buildDepositTransaction({
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
  assert.throws(
    () => createEvmExecutor(account, 'http://localhost:8545', 1),
    /Unsupported EVM chain ID/,
  );
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
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  const result = await evmSign({ ok: true }, CROSS_SIGN_URL);
  assert.equal(capturedUrl, CROSS_SIGN_URL);
  assert.deepEqual(result.transaction, MOCK_CROSS_SIGN_TX);
  assert.equal(result.signature, '0xsig');
});

test('evmSign throws FastError on cross-sign error response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: 'Invalid certificate' } });
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => evmSign({ ok: true }, CROSS_SIGN_URL),
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
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => evmSign({ ok: true }, CROSS_SIGN_URL),
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

  const mockClients = {
    walletClient: {
      sendTransaction: async (tx: { to: string; data: string; value: bigint }) => {
        sentTx = { to: tx.to, data: tx.data, value: tx.value.toString() };
        return TX_HASH;
      },
      writeContract: async () => {
        approveCallCount++;
        return TX_HASH;
      },
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      readContract: async () => 0n, // allowance = 0 → triggers approve
    },
  };

  const result = await executeDeposit({
    chainId: 421614,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS,
    amount: '1000000',
    senderAddress: EVM_ADDRESS,
    receiverAddress: FAST_ADDRESS,
    evmClients: mockClients as any,
  });

  assert.equal(approveCallCount, 1);
  assert.equal(sentTx?.to, BRIDGE_CONTRACT);
  assert.equal(sentTx?.value, '0');
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.orderId, TX_HASH);
});

test('executeDeposit skips approve when allowance is sufficient', async () => {
  let approveCallCount = 0;

  const mockClients = {
    walletClient: {
      sendTransaction: async () => TX_HASH,
      writeContract: async () => { approveCallCount++; return TX_HASH; },
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'success' }),
      readContract: async () => 2_000_000n, // allowance > amount
    },
  };

  await executeDeposit({
    chainId: 421614,
    bridgeContract: BRIDGE_CONTRACT,
    tokenAddress: TOKEN_ADDRESS,
    amount: '1000000',
    senderAddress: EVM_ADDRESS,
    receiverAddress: FAST_ADDRESS,
    evmClients: mockClients as any,
  });

  assert.equal(approveCallCount, 0);
});

test('executeDeposit throws FastError on reverted transaction', async () => {
  const mockClients = {
    walletClient: {
      sendTransaction: async () => TX_HASH,
      writeContract: async () => TX_HASH,
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'reverted' }),
      readContract: async () => 2_000_000n,
    },
  };

  await assert.rejects(
    () => executeDeposit({
      chainId: 421614,
      bridgeContract: BRIDGE_CONTRACT,
      tokenAddress: TOKEN_ADDRESS,
      amount: '1000000',
      senderAddress: EVM_ADDRESS,
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
    () => executeDeposit({
      chainId: 421614,
      bridgeContract: BRIDGE_CONTRACT,
      tokenAddress: TOKEN_ADDRESS,
      amount: '1000000',
      senderAddress: EVM_ADDRESS,
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

test('executeIntent performs 2 Fast submits + 2 cross-signs + 1 relayer call', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const submitCalls: unknown[] = [];

  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).includes('/relay')) {
      return Response.json({ ok: true });
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  const result = await executeIntent({
    fastBridgeAddress: FAST_BRIDGE_ADDRESS,
    relayerUrl: RELAY_URL,
    crossSignUrl: CROSS_SIGN_URL,
    tokenEvmAddress: TOKEN_ADDRESS,
    tokenFastTokenId: TOKEN_FAST_ID,
    amount: '1000000',
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    fastWallet: {
      address: FAST_ADDRESS,
      async submit(params) {
        submitCalls.push(params);
        return { txHash: TX_HASH, certificate: { ok: true } };
      },
    } as any,
  });

  assert.equal(submitCalls.length, 2);
  assert.equal(urls.filter(u => u === CROSS_SIGN_URL).length, 2);
  assert.equal(urls.filter(u => u.includes('/relay')).length, 1);
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.orderId, TX_HASH);
});

test('executeIntent uses fastBridgeAddress as recipient in TokenTransfer', async () => {
  const originalFetch = globalThis.fetch;
  const submitCalls: Array<{ claim: Record<string, unknown> }> = [];

  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) return Response.json({ ok: true });
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await executeIntent({
    fastBridgeAddress: FAST_BRIDGE_ADDRESS,
    relayerUrl: RELAY_URL,
    crossSignUrl: CROSS_SIGN_URL,
    tokenEvmAddress: TOKEN_ADDRESS,
    tokenFastTokenId: TOKEN_FAST_ID,
    amount: '1000000',
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    fastWallet: {
      address: FAST_ADDRESS,
      async submit(params) {
        submitCalls.push(params as any);
        return { txHash: TX_HASH, certificate: { ok: true } };
      },
    } as any,
  });

  const expectedRecipient = Array.from(fastAddressToBytes(FAST_BRIDGE_ADDRESS));
  const tokenTransfer = (submitCalls[0].claim as any)?.TokenTransfer;
  assert.deepEqual(Array.from(tokenTransfer?.recipient ?? []), expectedRecipient);
});

test('executeIntent sends correct relayer payload', async () => {
  const originalFetch = globalThis.fetch;
  let relayerBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/relay')) {
      relayerBody = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await executeIntent({
    fastBridgeAddress: FAST_BRIDGE_ADDRESS,
    relayerUrl: RELAY_URL,
    crossSignUrl: CROSS_SIGN_URL,
    tokenEvmAddress: TOKEN_ADDRESS,
    tokenFastTokenId: TOKEN_FAST_ID,
    amount: '1000000',
    intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
    fastWallet: {
      address: FAST_ADDRESS,
      async submit() { return { txHash: TX_HASH, certificate: { ok: true } }; },
    } as any,
  });

  assert.equal(relayerBody?.fastset_address, FAST_ADDRESS);
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
      return Response.json({ ok: true });
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await executeIntent({
    fastBridgeAddress: FAST_BRIDGE_ADDRESS,
    relayerUrl: RELAY_URL,
    crossSignUrl: CROSS_SIGN_URL,
    tokenEvmAddress: TOKEN_ADDRESS,
    tokenFastTokenId: TOKEN_FAST_ID,
    amount: '1000000',
    intents: [buildExecuteIntent(contractAddress, '0xabcdef')],
    fastWallet: {
      address: FAST_ADDRESS,
      async submit() { return { txHash: TX_HASH, certificate: { ok: true } }; },
    } as any,
  });

  assert.equal(relayerBody?.external_address, contractAddress);
});

test('executeIntent throws FastError when no external address can be resolved', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => executeIntent({
      fastBridgeAddress: FAST_BRIDGE_ADDRESS,
      relayerUrl: RELAY_URL,
      crossSignUrl: CROSS_SIGN_URL,
      tokenEvmAddress: TOKEN_ADDRESS,
      tokenFastTokenId: TOKEN_FAST_ID,
      amount: '1000000',
      intents: [buildRevokeIntent()],
      fastWallet: {
        address: FAST_ADDRESS,
        async submit() { return { txHash: TX_HASH, certificate: { ok: true } }; },
      } as any,
    }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'INVALID_PARAMS');
      return true;
    },
  );
});

test('executeIntent throws FastError when intents array is empty', async () => {
  await assert.rejects(
    () => executeIntent({
      fastBridgeAddress: FAST_BRIDGE_ADDRESS,
      relayerUrl: RELAY_URL,
      crossSignUrl: CROSS_SIGN_URL,
      tokenEvmAddress: TOKEN_ADDRESS,
      tokenFastTokenId: TOKEN_FAST_ID,
      amount: '1000000',
      intents: [],
      fastWallet: {
        address: FAST_ADDRESS,
        async submit() { return { txHash: TX_HASH, certificate: { ok: true } }; },
      } as any,
    }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'INVALID_PARAMS');
      return true;
    },
  );
});

test('executeIntent preserves upstream FastError from fastWallet.submit', async () => {
  const upstreamError = new FastError('TX_FAILED', 'upstream failure', { note: 'keep identity' });

  await assert.rejects(
    () => executeIntent({
      fastBridgeAddress: FAST_BRIDGE_ADDRESS,
      relayerUrl: RELAY_URL,
      crossSignUrl: CROSS_SIGN_URL,
      tokenEvmAddress: TOKEN_ADDRESS,
      tokenFastTokenId: TOKEN_FAST_ID,
      amount: '1000000',
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      fastWallet: {
        address: FAST_ADDRESS,
        async submit() { throw upstreamError; },
      } as any,
    }),
    (error: unknown) => {
      assert.equal(error, upstreamError);
      return true;
    },
  );
});

test('executeIntent throws FastError on relayer failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) {
      return new Response('internal error', { status: 500 });
    }
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => executeIntent({
      fastBridgeAddress: FAST_BRIDGE_ADDRESS,
      relayerUrl: RELAY_URL,
      crossSignUrl: CROSS_SIGN_URL,
      tokenEvmAddress: TOKEN_ADDRESS,
      tokenFastTokenId: TOKEN_FAST_ID,
      amount: '1000000',
      intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
      fastWallet: {
        address: FAST_ADDRESS,
        async submit() { return { txHash: TX_HASH, certificate: { ok: true } }; },
      } as any,
    }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'TX_FAILED');
      assert.match((error as Error).message, /Relayer request failed/);
      return true;
    },
  );
});
