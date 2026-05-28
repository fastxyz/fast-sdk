import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { FastError } from '../src/errors.ts';
import { encodeFunctionData } from 'viem';
import { Signer, FastProvider } from '../../fast-sdk/src/index.ts';
import { Schema } from 'effect';
import { TransactionCertificateFromRpc } from '@fastxyz/schema';

import {
  // address
  fastAddressToBytes32,
  fastAddressToBytes,
  FastAccountClient,
  createDelegatedAccessKeySigner,
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
  executeWithdraw,
  // eip7702
  smartDeposit,
  InsufficientBalanceError,
  createPasskeyOwnerSigner,
  createTransactionSigningMessage,
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

const MOCK_CROSS_SIGN_TX = [...Array(32).fill(0), ...Array(32).fill(0x11)];

function rpcResult(result: unknown): Response {
  const encodeValue = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return value;
  };

  return new Response(
    JSON.stringify(
      { jsonrpc: '2.0', id: 1, result },
      encodeValue,
    ),
    {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    },
  );
}

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

const MOCK_CERTIFICATE_RPC = Schema.encodeSync(TransactionCertificateFromRpc)(MOCK_CERTIFICATE);

// ---------------------------------------------------------------------------
// Entrypoint Tests
// ---------------------------------------------------------------------------

test('single entrypoint exposes all public API', () => {
  assert.equal(typeof fastAddressToBytes32, 'function');
  assert.equal(typeof FastAccountClient, 'function');
  assert.equal(typeof createDelegatedAccessKeySigner, 'function');
  assert.equal(typeof createPasskeyOwnerSigner, 'function');
  assert.equal(typeof createTransactionSigningMessage, 'function');
  assert.equal(typeof buildDepositTransaction, 'function');
  assert.equal(typeof buildTransferIntent, 'function');
  assert.equal(typeof createEvmWallet, 'function');
  assert.equal(typeof executeDeposit, 'function');
  assert.equal(typeof executeIntent, 'function');
  assert.equal(typeof executeWithdraw, 'function');
  assert.equal(typeof evmSign, 'function');
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
// Account Client / Signer Tests
// ---------------------------------------------------------------------------

test('FastAccountClient submits a delegated access key authorization envelope', async () => {
  const provider = new FastProvider({ rpcUrl: 'http://localhost:9999' });
  const signer = createDelegatedAccessKeySigner({
    address: FAST_ADDRESS,
    policy: {
      client_id: 'app.fast.xyz',
      expires_at: '2026-04-30T00:00:00Z',
      allowed_operations: ['TokenTransfer'],
      allowed_tokens: ['USDC'],
      max_total_spend: '1000000',
    },
    authorizeTransaction: async () => ({
      access_key_id: 'ak_test_123',
      signature: [9, 9, 9],
      policy: {
        client_id: 'app.fast.xyz',
        expires_at: '2026-04-30T00:00:00Z',
        allowed_operations: ['TokenTransfer'],
        allowed_tokens: ['USDC'],
        max_total_spend: '1000000',
      },
    }),
  });

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: {
        transaction?: {
          Release20260319?: {
            nonce?: number;
          };
        };
        signature?: {
          DelegatedAccessKey?: {
            access_key_id?: string;
            signature?: number[];
            policy?: { client_id?: string };
          };
        };
      };
    };

    if (body.method === 'proxy_getAccountInfo') {
      return rpcResult({ next_nonce: 4 });
    }

    if (body.method === 'proxy_submitTransaction') {
      assert.equal(body.params.transaction?.Release20260319?.nonce, '4');
      assert.equal(body.params.signature?.DelegatedAccessKey?.access_key_id, 'ak_test_123');
      assert.deepEqual(body.params.signature?.DelegatedAccessKey?.signature, [9, 9, 9]);
      assert.equal(body.params.signature?.DelegatedAccessKey?.policy?.client_id, 'app.fast.xyz');
      return rpcResult({ Success: MOCK_CERTIFICATE_RPC });
    }

    throw new Error(`Unexpected RPC method: ${body.method}`);
  };

  const client = await FastAccountClient.connect({ provider, signer });
  const identity = await client.getAccountIdentity();
  assert.equal(identity.address, FAST_ADDRESS);
  assert.equal(identity.signer.kind, 'delegated-access-key');
  assert.equal(identity.signer.role, 'delegated');

  const result = await client.submit({
    nonce: 4,
    claim: {
      type: 'TokenTransfer',
      value: {
        tokenId: new Array(32).fill(0),
        recipient: fastAddressToBytes(FAST_ADDRESS),
        amount: '1',
        userData: null,
      },
    },
  });

  assert.ok(result.txHash);
  assert.ok(result.certificate.envelope);
});

test('FastAccountClient prepares and submits a passkey-owner transaction', async () => {
  const provider = new FastProvider({ rpcUrl: 'http://localhost:9999' });
  let authorizeCalls = 0;
  const signer = createPasskeyOwnerSigner({
    address: FAST_ADDRESS,
    authorizeTransaction: async () => {
      authorizeCalls += 1;
      return {
        credential_id: 'credential-1',
        authenticator_data: 'auth-data',
        client_data_json: 'client-data',
        signature: 'sig',
        rp_id: 'app.fast.xyz',
        challenge: 'challenge-1',
      };
    },
  });

  globalThis.fetch = async (_input, init) => {
    const rawBody = String(init?.body);
    const body = JSON.parse(rawBody) as {
      method: string;
      params: {
        transaction?: {
          Release20260319?: {
            nonce?: number;
            timestamp_nanos?: number;
          };
        };
        signature?: {
          PasskeyOwner?: {
            credential_id?: string;
            rp_id?: string;
            challenge?: string;
          };
        };
      };
    };

    if (body.method === 'proxy_submitTransaction') {
      assert.equal(body.params.transaction?.Release20260319?.nonce, '11');
      assert.match(rawBody, /"timestamp_nanos":"1773281639713000000"/);
      assert.equal(body.params.signature?.PasskeyOwner?.credential_id, 'credential-1');
      assert.equal(body.params.signature?.PasskeyOwner?.rp_id, 'app.fast.xyz');
      assert.equal(body.params.signature?.PasskeyOwner?.challenge, 'challenge-1');
      return rpcResult({ Success: MOCK_CERTIFICATE_RPC });
    }

    if (body.method === 'proxy_getAccountInfo') {
      return rpcResult({ next_nonce: 11 });
    }

    throw new Error(`Unexpected RPC method: ${body.method}`);
  };

  const client = await FastAccountClient.connect({ provider, signer });
  const prepared = await client.prepareTransaction({
    claim: {
      type: 'TokenTransfer',
      value: {
        tokenId: new Array(32).fill(0),
        recipient: fastAddressToBytes(FAST_ADDRESS),
        amount: '1',
        userData: null,
      },
    },
    nonce: 11,
    timestampNanos: 1773281639713000000n,
  });

  assert.ok(prepared.txHash);
  assert.deepEqual(
    Array.from(prepared.signingMessage),
    Array.from(createTransactionSigningMessage(prepared.transaction)),
  );

  const authorized = await client.authorizePreparedTransaction(prepared);
  assert.equal(authorized.authorization.address, FAST_ADDRESS);
  assert.equal(authorizeCalls, 1);

  const result = await client.submitPreparedTransaction(
    authorized.preparedTransaction,
    authorized.authorization,
  );

  assert.equal(authorizeCalls, 1);
  assert.ok(result.txHash);
  assert.ok(result.certificate.envelope);
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
    if (String(url).includes('/relay')) return Response.json({ ok: true });
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

test('executeIntent uses fastBridgeAddress as recipient in TokenTransfer', async () => {
  const originalFetch = globalThis.fetch;
  const submitCalls: unknown[] = [];

  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) return Response.json({ ok: true });
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
      return Response.json({ ok: true });
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
      return Response.json({ ok: true });
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
  globalThis.fetch = async () => Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () =>
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [buildRevokeIntent()],
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

test('executeIntent preserves upstream error from provider', async () => {
  const upstreamError = new FastError('TX_FAILED', 'upstream failure', { note: 'keep identity' });

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

test('executeIntent throws FastError on relayer failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/relay')) return new Response('internal error', { status: 500 });
    return Response.json({ result: { transaction: MOCK_CROSS_SIGN_TX, signature: '0xsig' } });
  };
  onTestFinished(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () =>
      executeIntent({
        ...BASE_INTENT_PARAMS,
        intents: [buildTransferIntent(TOKEN_ADDRESS, EVM_ADDRESS)],
        signer: testSigner,
        provider: makeMockProvider(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof FastError);
      assert.equal((error as FastError).code, 'TX_FAILED');
      assert.match((error as Error).message, /Relayer request failed/);
      return true;
    },
  );
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
      return Response.json({ ok: true });
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
