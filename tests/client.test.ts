import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FastAccountClient,
  FastProvider,
  FastWallet,
  bytesToHex,
  encodeFastAddress,
  createDelegatedAccessKeySigner,
  createPasskeyOwnerSigner,
  createTransactionSigningMessage,
  fastAddressToBytes,
} from '../src/index.js';
import { FastError } from '../src/core/errors.js';
import { clearDefaultsCache } from '../src/config/file-loader.js';
import type { FastTransactionCertificate } from '../src/index.js';
import { FAST_NETWORK_IDS, FAST_TOKEN_ID } from '../src/core/bcs.js';
import { bytesToPrefixedHex } from '../src/core/bytes.js';

let tmpDir: string;
let originalConfigDir: string | undefined;
const originalFetch = globalThis.fetch;
const VALID_FAST_ADDRESS = 'fast1424242424242424242424242424242424242424242424242424qlc29x9';
const NATIVE_FAST_TOKEN_ID = bytesToPrefixedHex(FAST_TOKEN_ID);
// testUSDC token ID on fast:testnet
const TEST_USDC_TOKEN_ID = [215, 58, 6, 121, 162, 190, 70, 152, 30, 42, 138, 237, 236, 217, 81, 200, 182, 105, 14, 125, 95, 133, 2, 179, 78, 211, 255, 76, 194, 22, 59, 70] as const;

function rpcResult(result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function sampleCertificate(nonce = 7): FastTransactionCertificate {
  return {
    envelope: {
      transaction: {
        Release20260319: {
          network_id: FAST_NETWORK_IDS.TESTNET,
          sender: new Array(32).fill(0),
          nonce,
          timestamp_nanos: 1,
          claim: {
            TokenTransfer: {
              token_id: new Array(32).fill(0),
              recipient: new Array(32).fill(1),
              amount: '1',
              user_data: null,
            },
          },
          archival: false,
          fee_token: null,
        },
      },
      signature: { Signature: [] },
    },
    signatures: [],
  } as FastTransactionCertificate;
}

before(async () => {
  originalConfigDir = process.env.FAST_CONFIG_DIR;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-client-test-'));
  process.env.FAST_CONFIG_DIR = tmpDir;
  clearDefaultsCache();
});

after(async () => {
  if (originalConfigDir !== undefined) {
    process.env.FAST_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.FAST_CONFIG_DIR;
  }
  clearDefaultsCache();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  clearDefaultsCache();
  await fs.rm(path.join(tmpDir, 'networks.json'), { force: true });
  await fs.rm(path.join(tmpDir, 'tokens.json'), { force: true });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * FastProvider Tests
 * ───────────────────────────────────────────────────────────────────────────── */

describe('FastProvider', () => {
  describe('constructor', () => {
    it('creates provider with default options', () => {
      const provider = new FastProvider();
      assert.ok(provider);
      assert.equal(provider.network, 'testnet');
    });

    it('creates provider with custom network', () => {
      const provider = new FastProvider({ network: 'mainnet' });
      assert.equal(provider.network, 'mainnet');
    });

    it('creates provider with custom RPC URL', () => {
      const provider = new FastProvider({ rpcUrl: 'https://custom.rpc.com' });
      assert.equal(provider.rpcUrl, 'https://custom.rpc.com');
    });
  });

  describe('low-level proxy methods', () => {
    it('submits a transaction through proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: {
            transaction?: {
              Release20260319?: {
                network_id?: string;
                nonce?: number;
              };
            };
            signature?: { Signature?: number[] };
          };
        };
        assert.equal(body.method, 'proxy_submitTransaction');
        assert.equal(body.params.transaction?.Release20260319?.network_id, FAST_NETWORK_IDS.TESTNET);
        assert.equal(body.params.transaction?.Release20260319?.nonce, 9);
        assert.deepEqual(body.params.signature, { Signature: [7, 7, 7] });
        return rpcResult(certificate);
      };

      const provider = new FastProvider();
      const result = await provider.submitTransaction({
        transaction: {
          network_id: FAST_NETWORK_IDS.TESTNET,
          sender: new Uint8Array(32).fill(2),
          nonce: 9,
          timestamp_nanos: 10n,
          claim: {
            TokenTransfer: {
              token_id: FAST_TOKEN_ID,
              recipient: new Uint8Array(32).fill(3),
              amount: '1',
              user_data: null,
            },
          },
          archival: false,
          fee_token: null,
        },
        signature: { Signature: [7, 7, 7] },
      });

      assert.deepEqual(result, { Success: certificate });
    });

    it('calls proxy_faucetDrip with a resolved token id', async () => {
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: { amount?: string; token_id?: number[] | null };
        };
        assert.equal(body.method, 'proxy_faucetDrip');
        assert.equal(body.params.amount, 'f4240');
        assert.deepEqual(body.params.token_id, [...TEST_USDC_TOKEN_ID]);
        return rpcResult(null);
      };

      const provider = new FastProvider();
      await provider.faucetDrip({
        recipient: VALID_FAST_ADDRESS,
        amount: '0xf4240',
        token: 'testUSDC',
      });
    });

    it('fetches transaction certificates through the dedicated proxy method', async () => {
      const certificate = sampleCertificate(7);
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: { from_nonce?: number; limit?: number };
        };
        assert.equal(body.method, 'proxy_getTransactionCertificates');
        assert.equal(body.params.from_nonce, 7);
        assert.equal(body.params.limit, 2);
        return rpcResult([certificate]);
      };

      const provider = new FastProvider();
      const result = await provider.getTransactionCertificates(VALID_FAST_ADDRESS, 7, 2);
      assert.deepEqual(result, [certificate]);
    });
  });

  describe('getBalance (mocked)', () => {
    it('returns FAST balance from RPC', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x8ac7230489e80000', // 10 FAST in hex (10 * 10^18)
      });

      const provider = new FastProvider();
      const balance = await provider.getBalance(VALID_FAST_ADDRESS);
      assert.equal(balance.token, 'FAST');
      assert.equal(balance.amount, '10');
    });

    it('returns 0 for unknown address', async () => {
      globalThis.fetch = async () => rpcResult(null);

      const provider = new FastProvider();
      const balance = await provider.getBalance(VALID_FAST_ADDRESS);
      assert.equal(balance.amount, '0');
    });

    it('returns testUSDC balance by symbol', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
          token_balance: [
            [TEST_USDC_TOKEN_ID, '0xf4240'], // 1.0 USDC (1_000_000 with 6 decimals)
          ],
        });

      const provider = new FastProvider();
      const balance = await provider.getBalance(
        VALID_FAST_ADDRESS,
        'testUSDC'
      );
      assert.equal(balance.token, 'testUSDC');
      assert.equal(balance.amount, '1');
    });

    it('returns FAST balance by native token hex id', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0xde0b6b3a7640000',
        token_balance: [],
      });

      const provider = new FastProvider();
      const balance = await provider.getBalance(VALID_FAST_ADDRESS, NATIVE_FAST_TOKEN_ID);
      assert.equal(balance.token, 'FAST');
      assert.equal(balance.amount, '1');
    });

    it('uses live token decimals for symbol balances when config is stale', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'tokens.json'),
        JSON.stringify({ testnet: { TESTUSDC: { symbol: 'testUSDC', tokenId: '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46', decimals: 18 } } })
      );
      clearDefaultsCache();

      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === 'proxy_getAccountInfo') {
          return rpcResult({
            balance: '0x0',
            token_balance: [[TEST_USDC_TOKEN_ID, '0xf4240']],
          });
        }
        if (body.method === 'proxy_getTokenInfo') {
          return rpcResult({
            requested_token_metadata: [
              [TEST_USDC_TOKEN_ID, { token_name: 'testUSDC', decimals: 6 }],
            ],
          });
        }
        throw new Error(`Unexpected RPC method: ${body.method}`);
      };

      const provider = new FastProvider();
      const balance = await provider.getBalance(VALID_FAST_ADDRESS, 'testUSDC');
      assert.equal(balance.amount, '1');
    });
  });

  describe('getTokens (mocked)', () => {
    it('returns all tokens for an address', async () => {
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount === 1) {
          // Account info
          return rpcResult({
            balance: '0xde0b6b3a7640000', // 1 FAST
            token_balance: [
              [TEST_USDC_TOKEN_ID, '0xf4240'], // 1.0 USDC
            ],
          });
        }
        // Token info
        return rpcResult({
          requested_token_metadata: [
            [TEST_USDC_TOKEN_ID, { token_name: 'testUSDC', decimals: 6 }],
          ],
        });
      };

      const provider = new FastProvider();
      const tokens = await provider.getTokens(VALID_FAST_ADDRESS);
      
      assert.ok(tokens.length >= 1);
      const fastToken = tokens.find(t => t.symbol === 'FAST');
      assert.ok(fastToken);
    });
  });

  describe('getTokenInfo (mocked)', () => {
    it('returns FAST token info without RPC call', async () => {
      const provider = new FastProvider();
      const info = await provider.getTokenInfo('FAST');
      assert.ok(info);
      assert.equal(info.symbol, 'FAST');
      assert.equal(info.decimals, 18);
    });

    it('returns FAST token info for the native token hex id without RPC call', async () => {
      const provider = new FastProvider();
      const info = await provider.getTokenInfo(NATIVE_FAST_TOKEN_ID);
      assert.ok(info);
      assert.equal(info.symbol, 'FAST');
      assert.equal(info.tokenId, 'native');
      assert.equal(info.decimals, 18);
    });

    it('does not resolve token symbols from another network', async () => {
      let rpcCalled = false;
      globalThis.fetch = async () => {
        rpcCalled = true;
        throw new Error('RPC should not be called for symbols missing from the selected network');
      };

      const provider = new FastProvider({ network: 'testnet' });
      const info = await provider.getTokenInfo('USDC');
      assert.equal(info, null);
      assert.equal(rpcCalled, false);
    });

    it('returns null for unknown token', async () => {
      globalThis.fetch = async () => rpcResult({
        requested_token_metadata: [],
      });

      const provider = new FastProvider();
      const info = await provider.getTokenInfo('unknown');
      assert.equal(info, null);
    });

    it('returns full admin and minter metadata', async () => {
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        assert.equal(body.method, 'proxy_getTokenInfo');
        return rpcResult({
          requested_token_metadata: [
            [
              TEST_USDC_TOKEN_ID,
              {
                token_name: 'testUSDC',
                decimals: 6,
                total_supply: '1000000',
                admin: [1, 2, 3, 4],
                mints: [[5, 6, 7, 8], [9, 10, 11, 12]],
              },
            ],
          ],
        });
      };

      const provider = new FastProvider();
      const info = await provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46');
      assert.ok(info);
      assert.equal(info.admin, '0x01020304');
      assert.deepEqual(info.minters, ['0x05060708', '0x090a0b0c']);
    });
  });

  describe('getExplorerUrl', () => {
    it('returns explorer URL from network config', async () => {
      const provider = new FastProvider();
      const url = await provider.getExplorerUrl();
      assert.ok(url === null || url.includes('fast.xyz') || url.includes('explorer'));
    });

    it('returns explorer URL with tx hash', async () => {
      const provider = new FastProvider({ explorerUrl: 'https://test.explorer.com' });
      const url = await provider.getExplorerUrl('abc123');
      assert.ok(url);
      assert.ok(url.includes('abc123'));
      assert.ok(url.includes('test.explorer.com'));
    });

    it('returns null when no explorer configured', async () => {
      const provider = new FastProvider({ 
        rpcUrl: 'https://custom.rpc.com',
        explorerUrl: undefined 
      });
      // Force init without network lookup
      (provider as any)._initialized = true;
      (provider as any)._explorerUrl = null;
      const url = await provider.getExplorerUrl('abc123');
      assert.equal(url, null);
    });

    it('uses explicit explorerUrl from constructor', async () => {
      const provider = new FastProvider({ 
        explorerUrl: 'https://my-explorer.com' 
      });
      const url = await provider.getExplorerUrl();
      assert.equal(url, 'https://my-explorer.com');
    });

    it('loads explorer and RPC from a custom named network', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'networks.json'),
        JSON.stringify({
          custom: {
            rpc: 'https://custom.example.com/proxy',
            explorer: 'https://custom.example.com/explorer',
          },
        })
      );
      clearDefaultsCache();

      const provider = new FastProvider({ network: 'custom' });
      const url = await provider.getExplorerUrl();
      assert.equal(provider.network, 'custom');
      assert.equal(provider.rpcUrl, 'https://custom.example.com/proxy');
      assert.equal(url, 'https://custom.example.com/explorer');
    });
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * FastAccountClient Tests
 * ───────────────────────────────────────────────────────────────────────────── */

describe('FastAccountClient', () => {
  it('connects a delegated access key signer and submits its authorization envelope', async () => {
    const provider = new FastProvider();
    const signer = createDelegatedAccessKeySigner({
      address: VALID_FAST_ADDRESS,
      policy: {
        client_id: 'app.fast.xyz',
        expires_at: '2026-04-30T00:00:00Z',
        allowed_operations: ['TokenTransfer'],
        allowed_tokens: ['USDC'],
        max_total_spend: '1000000',
      },
      authorizeTransaction: async () => ({
        access_key_id: new Array(32).fill(7),
        delegate: new Array(32).fill(8),
        client_id: 'app.fast.xyz',
        signature: [9, 9, 9],
      }),
    });

    globalThis.fetch = async (_input, init) => {
      const rawBody = String(init?.body);
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
              access_key_id?: number[];
              delegate?: number[];
              client_id?: string;
              signature?: number[];
            };
          };
        };
      };

      if (body.method === 'proxy_getAccountInfo') {
        return rpcResult({ next_nonce: 4 });
      }

      if (body.method === 'proxy_submitTransaction') {
        assert.equal(body.params.transaction?.Release20260319?.nonce, 4);
        assert.deepEqual(body.params.signature?.DelegatedAccessKey?.access_key_id, new Array(32).fill(7));
        assert.deepEqual(body.params.signature?.DelegatedAccessKey?.delegate, new Array(32).fill(8));
        assert.deepEqual(body.params.signature?.DelegatedAccessKey?.signature, [9, 9, 9]);
        assert.equal(body.params.signature?.DelegatedAccessKey?.client_id, 'app.fast.xyz');
        return rpcResult(sampleCertificate(4));
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    };

    const client = await FastAccountClient.connect({ provider, signer });
    const identity = await client.getAccountIdentity();
    assert.equal(identity.address, VALID_FAST_ADDRESS);
    assert.equal(identity.signer.kind, 'delegated-access-key');
    assert.equal(identity.signer.role, 'delegated');

    const result = await client.submit({
      claim: {
        TokenTransfer: {
          token_id: FAST_TOKEN_ID,
          recipient: fastAddressToBytes(VALID_FAST_ADDRESS),
          amount: '1',
          user_data: null,
        },
      },
    });

    assert.ok(result.txHash);
    assert.ok(result.certificate.envelope);
  });

  it('prepares, authorizes, and submits a passkey-owner transaction in separate steps', async () => {
    const provider = new FastProvider();
    let authorizeCalls = 0;
    const signer = createPasskeyOwnerSigner({
      address: VALID_FAST_ADDRESS,
      authorizeTransaction: async () => {
        authorizeCalls += 1;
        return {
          config: {
            credential_id: [1, 2, 3],
            rp_id: 'app.fast.xyz',
            origin: 'https://app.fast.xyz',
            public_key_x: new Array(32).fill(4),
            public_key_y: new Array(32).fill(5),
          },
          authenticator_data: [6, 6, 6],
          client_data_json: [7, 7, 7],
          signature: [8, 8, 8],
        };
      },
    });

    globalThis.fetch = async (_input, init) => {
      const rawBody = String(init?.body);
      const body = JSON.parse(String(init?.body)) as {
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
              config?: {
                credential_id?: number[];
                rp_id?: string;
                origin?: string;
                public_key_x?: number[];
                public_key_y?: number[];
              };
              authenticator_data?: number[];
              client_data_json?: number[];
              signature?: number[];
            };
          };
        };
      };

      if (body.method === 'proxy_submitTransaction') {
        assert.equal(body.params.transaction?.Release20260319?.nonce, 11);
        assert.match(rawBody, /"timestamp_nanos":1773281639713000000/);
        assert.deepEqual(body.params.signature?.PasskeyOwner?.config?.credential_id, [1, 2, 3]);
        assert.equal(body.params.signature?.PasskeyOwner?.config?.rp_id, 'app.fast.xyz');
        assert.equal(body.params.signature?.PasskeyOwner?.config?.origin, 'https://app.fast.xyz');
        assert.deepEqual(body.params.signature?.PasskeyOwner?.signature, [8, 8, 8]);
        return rpcResult(sampleCertificate(11));
      }

      throw new Error(`Unexpected RPC method: ${body.method}`);
    };

    const client = await FastAccountClient.connect({ provider, signer });
    const prepared = await client.prepareTransaction({
      claim: {
        TokenTransfer: {
          token_id: FAST_TOKEN_ID,
          recipient: fastAddressToBytes(VALID_FAST_ADDRESS),
          amount: '1',
          user_data: null,
        },
      },
      nonce: 11,
      timestampNanos: 1773281639713000000n,
    });

    assert.ok(prepared.txHash);
    assert.equal(
      bytesToHex(prepared.signingMessage),
      bytesToHex(createTransactionSigningMessage(prepared.transaction)),
    );

    const authorized = await client.authorizePreparedTransaction(prepared);
    assert.equal(authorized.authorization.address, VALID_FAST_ADDRESS);
    assert.equal(authorizeCalls, 1);

    const result = await client.submitPreparedTransaction(
      authorized.preparedTransaction,
      authorized.authorization,
    );

    assert.equal(authorizeCalls, 1);
    assert.ok(result.txHash);
    assert.ok(result.certificate.envelope);
  });

  it('rejects externally supplied authorization for another account', async () => {
    const provider = new FastProvider();
    const signer = createDelegatedAccessKeySigner({
      address: VALID_FAST_ADDRESS,
      policy: { client_id: 'app.fast.xyz' },
      authorizeTransaction: async () => ({
        access_key_id: new Array(32).fill(1),
        delegate: new Array(32).fill(2),
        client_id: 'app.fast.xyz',
        signature: [5, 5, 5],
      }),
    });

    const client = await FastAccountClient.connect({ provider, signer });
    const prepared = await client.prepareTransaction({
      claim: {
        TokenTransfer: {
          token_id: FAST_TOKEN_ID,
          recipient: fastAddressToBytes(VALID_FAST_ADDRESS),
          amount: '1',
          user_data: null,
        },
      },
      nonce: 3,
    });
    const otherAddress = encodeFastAddress(new Uint8Array(32).fill(9));

    await assert.rejects(
      () => client.submitPreparedTransaction(prepared, {
        address: otherAddress,
        capabilities: {
          kind: 'delegated-access-key',
          role: 'delegated',
          origin: 'hybrid',
          canSignMessages: false,
          canAuthorizeTransactions: true,
        },
        signature: {
          DelegatedAccessKey: {
            access_key_id: new Array(32).fill(3),
            delegate: new Array(32).fill(4),
            client_id: 'app.fast.xyz',
            signature: [1, 2, 3],
          },
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('rejects arbitrary message signing when the signer is transaction-only', async () => {
    const provider = new FastProvider();
    const signer = createPasskeyOwnerSigner({
      address: VALID_FAST_ADDRESS,
      authorizeTransaction: async () => ({
        config: {
          credential_id: [1, 2, 3],
          rp_id: 'app.fast.xyz',
          origin: 'https://app.fast.xyz',
          public_key_x: new Array(32).fill(4),
          public_key_y: new Array(32).fill(5),
        },
        authenticator_data: [6, 6, 6],
        client_data_json: [7, 7, 7],
        signature: [8, 8, 8],
      }),
    });

    const client = await FastAccountClient.connect({ provider, signer });
    await assert.rejects(
      () => client.sign({ message: 'hello' }),
      (error: unknown) => {
        assert.ok(error instanceof FastError);
        assert.equal(error.code, 'UNSUPPORTED_OPERATION');
        return true;
      },
    );
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * FastWallet Tests
 * ───────────────────────────────────────────────────────────────────────────── */

describe('FastWallet', () => {
  describe('fromKeyfile', () => {
    it('creates wallet and keyfile if missing (default behavior)', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'test-create.json');
      
      const wallet = await FastWallet.fromKeyfile(keyfilePath, provider);
      assert.ok(wallet.address.startsWith('fast1'));
      
      // Verify keyfile was created
      const stat = await fs.stat(keyfilePath);
      assert.ok(stat.isFile());
    });

    it('loads existing keyfile', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'test-existing.json');
      
      // Create keyfile first
      const wallet1 = await FastWallet.fromKeyfile(keyfilePath, provider);
      const address1 = wallet1.address;
      
      // Load it again
      const wallet2 = await FastWallet.fromKeyfile(keyfilePath, provider);
      assert.equal(wallet2.address, address1);
    });

    it('throws if keyfile missing and createIfMissing=false', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'nonexistent.json');
      
      await assert.rejects(
        () => FastWallet.fromKeyfile({ keyFile: keyfilePath, createIfMissing: false }, provider),
        (err: unknown) => {
          assert(err instanceof FastError);
          assert.equal(err.code, 'KEYFILE_NOT_FOUND');
          return true;
        }
      );
    });

    it('uses named key option', async () => {
      const provider = new FastProvider();
      const wallet = await FastWallet.fromKeyfile({ key: 'named-key-test' }, provider);
      assert.ok(wallet.address.startsWith('fast1'));
      
      // Verify keyfile exists with correct name
      const keyfilePath = path.join(tmpDir, 'keys', 'named-key-test.json');
      const stat = await fs.stat(keyfilePath);
      assert.ok(stat.isFile());
    });
  });

  describe('fromPrivateKey', () => {
    it('creates wallet from private key', async () => {
      const provider = new FastProvider();
      // Random 32-byte key (hex)
      const privateKey = 'a919e405ec3c4f8fdfcd892c434043ccf97742432e7cf686530e17fd842f74e3';
      
      const wallet = await FastWallet.fromPrivateKey(privateKey, provider);
      assert.ok(wallet.address.startsWith('fast1'));
    });

    it('throws on invalid private key length', async () => {
      const provider = new FastProvider();
      
      await assert.rejects(
        () => FastWallet.fromPrivateKey('abc', provider),
        (err: unknown) => {
          assert(err instanceof FastError);
          assert.equal(err.code, 'INVALID_PARAMS');
          return true;
        }
      );
    });
  });

  describe('generate', () => {
    it('generates random wallet', async () => {
      const provider = new FastProvider();
      const wallet = await FastWallet.generate(provider);
      assert.ok(wallet.address.startsWith('fast1'));
    });

    it('generates different wallets each time', async () => {
      const provider = new FastProvider();
      const wallet1 = await FastWallet.generate(provider);
      const wallet2 = await FastWallet.generate(provider);
      assert.notEqual(wallet1.address, wallet2.address);
    });

    it('can save generated wallet to keyfile', async () => {
      const provider = new FastProvider();
      const wallet = await FastWallet.generate(provider);
      
      const keyfilePath = path.join(tmpDir, 'keys', 'generated-save.json');
      await wallet.saveToKeyfile(keyfilePath);
      
      // Verify keyfile was created
      const stat = await fs.stat(keyfilePath);
      assert.ok(stat.isFile());
      
      // Verify we can load it
      const loaded = await FastWallet.fromKeyfile(keyfilePath, provider);
      assert.equal(loaded.address, wallet.address);
    });
  });

  describe('balance (mocked)', () => {
    it('returns FAST balance', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x8ac7230489e80000',
      });

      const provider = new FastProvider();
      const wallet = await FastWallet.generate(provider);
      const balance = await wallet.balance();
      assert.equal(balance.token, 'FAST');
      assert.equal(balance.amount, '10');
    });
  });

  describe('send (mocked)', () => {
    it('uses live token decimals for symbol sends when config is stale', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'tokens.json'),
        JSON.stringify({ testnet: { TESTUSDC: { symbol: 'testUSDC', tokenId: '0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46', decimals: 18 } } })
      );
      clearDefaultsCache();

      const provider = new FastProvider();
      const wallet = await FastWallet.generate(provider);
      let sawTokenInfo = false;

      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: {
            transaction?: {
              Release20260319?: {
                network_id?: string;
                claim?: {
                  TokenTransfer?: {
                    recipient?: number[];
                    amount?: string;
                  };
                };
              };
            };
          };
        };

        if (body.method === 'proxy_getTokenInfo') {
          sawTokenInfo = true;
          return rpcResult({
            requested_token_metadata: [
              [TEST_USDC_TOKEN_ID, { token_name: 'testUSDC', decimals: 6 }],
            ],
          });
        }

        if (body.method === 'proxy_getAccountInfo') {
          return rpcResult({ next_nonce: 7 });
        }

        if (body.method === 'proxy_submitTransaction') {
          assert.equal(body.params.transaction?.Release20260319?.network_id, FAST_NETWORK_IDS.TESTNET);
          assert.deepEqual(
            body.params.transaction?.Release20260319?.claim?.TokenTransfer?.recipient,
            Array.from(fastAddressToBytes(VALID_FAST_ADDRESS)),
          );
          assert.equal(body.params.transaction?.Release20260319?.claim?.TokenTransfer?.amount, 'f4240');
          return rpcResult(sampleCertificate(7));
        }

        throw new Error(`Unexpected RPC method: ${body.method}`);
      };

      const tx = await wallet.send({ to: VALID_FAST_ADDRESS, amount: '1', token: 'testUSDC' });
      assert.ok(sawTokenInfo);
      assert.ok(tx.txHash);
      assert.ok(tx.certificate.envelope);
    });

    it('rejects token symbols that are not configured for the selected network', async () => {
      let rpcCalled = false;
      globalThis.fetch = async () => {
        rpcCalled = true;
        throw new Error('RPC should not be called for symbols missing from the selected network');
      };

      const provider = new FastProvider({ network: 'testnet' });
      const wallet = await FastWallet.generate(provider);

      await assert.rejects(
        () => wallet.send({ to: VALID_FAST_ADDRESS, amount: '1', token: 'USDC' }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TOKEN_NOT_FOUND');
          return true;
        },
      );

      assert.equal(rpcCalled, false);
    });

    it('serializes timestamp_nanos with the exact digits sent for signing', async () => {
      const provider = new FastProvider();
      const wallet = await FastWallet.generate(provider);
      const fixedMs = 1773281639713;
      const expectedTimestamp = '1773281639713000000';
      const originalDateNow = Date.now;

      Date.now = () => fixedMs;

      try {
        globalThis.fetch = async (_input, init) => {
          const rawBody = String(init?.body);
          const body = JSON.parse(rawBody) as {
            method: string;
            params: {
              transaction?: {
                Release20260319?: {
                  network_id?: string;
                  timestamp_nanos?: number;
                };
              };
            };
          };

          if (body.method === 'proxy_getAccountInfo') {
            return rpcResult({ next_nonce: 7 });
          }

          if (body.method === 'proxy_submitTransaction') {
            assert.equal(body.params.transaction?.Release20260319?.network_id, FAST_NETWORK_IDS.TESTNET);
            assert.match(rawBody, new RegExp(`"timestamp_nanos":${expectedTimestamp}`));
            return rpcResult(sampleCertificate(7));
          }

          throw new Error(`Unexpected RPC method: ${body.method}`);
        };

        const tx = await wallet.send({ to: VALID_FAST_ADDRESS, amount: '1' });
        assert.ok(tx.txHash);
        assert.ok(tx.certificate.envelope);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  describe('sign/verify', () => {
    it('signs and verifies message', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'sign-test.json');
      const wallet = await FastWallet.fromKeyfile(keyfilePath, provider);

      const message = 'Hello, Fast!';
      const signed = await wallet.sign({ message });

      assert.ok(signed.signature);
      assert.equal(signed.address, wallet.address);
      assert.equal(signed.messageBytes, Buffer.from(message, 'utf8').toString('hex'));

      const verified = await wallet.verify({
        message,
        signature: signed.signature,
        address: wallet.address,
      });
      assert.ok(verified.valid);
    });

    it('verify fails for wrong message', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'sign-test-2.json');
      const wallet = await FastWallet.fromKeyfile(keyfilePath, provider);

      const signed = await wallet.sign({ message: 'original' });
      
      const verified = await wallet.verify({
        message: 'different',
        signature: signed.signature,
        address: wallet.address,
      });
      assert.equal(verified.valid, false);
    });

    it('verify throws INVALID_ADDRESS for malformed signer addresses', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'sign-test-3.json');
      const wallet = await FastWallet.fromKeyfile(keyfilePath, provider);

      const signed = await wallet.sign({ message: 'original' });

      await assert.rejects(
        () => wallet.verify({
          message: 'original',
          signature: signed.signature,
          address: 'invalid',
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'INVALID_ADDRESS');
          return true;
        },
      );
    });
  });

  describe('getCertificateByNonce', () => {
    it('returns the requested certificate for a nonce', async () => {
      const certificate = sampleCertificate(7);

      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: { from_nonce?: number; limit?: number };
        };
        assert.equal(body.method, 'proxy_getTransactionCertificates');
        assert.equal(body.params.from_nonce, 7);
        assert.equal(body.params.limit, 1);
        return rpcResult([certificate]);
      };

      const provider = new FastProvider();
      const result = await provider.getCertificateByNonce(VALID_FAST_ADDRESS, 7);
      assert.deepEqual(result, certificate);
    });

    it('returns null when the range query skips past the requested nonce', async () => {
      const certificate = sampleCertificate(8);

      globalThis.fetch = async () => rpcResult([certificate]);

      const provider = new FastProvider();
      const result = await provider.getCertificateByNonce(VALID_FAST_ADDRESS, 7);
      assert.equal(result, null);
    });

    it('does not mask RPC failures as missing certificates', async () => {
      globalThis.fetch = async () => new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'proxy unavailable' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getCertificateByNonce(VALID_FAST_ADDRESS, 7),
        /proxy unavailable/,
      );
    });
  });

  describe('exportKeys', () => {
    it('exports public key and address', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'export-test.json');
      const wallet = await FastWallet.fromKeyfile(keyfilePath, provider);

      const exported = await wallet.exportKeys();
      assert.ok(exported.publicKey);
      assert.equal(exported.publicKey.length, 64); // 32 bytes = 64 hex chars
      assert.equal(exported.address, wallet.address);
    });
  });
});
