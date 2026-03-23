import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FastProvider, FastWallet, fastAddressToBytes } from '../src/index.js';
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
      signature: { Signature: new Array(64).fill(7) },
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

    it('rejects malformed direct certificate results from proxy_submitTransaction', async () => {
      globalThis.fetch = async () => rpcResult({
        envelope: {},
        signatures: [],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          assert.match(error.note, /may have accepted this transaction/i);
          return true;
        },
      );
    });

    it('rejects malformed wrapped success results from proxy_submitTransaction', async () => {
      globalThis.fetch = async () => rpcResult({
        Success: {
          envelope: {},
          signatures: [],
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          assert.match(error.note, /may have accepted this transaction/i);
          return true;
        },
      );
    });

    it('rejects malformed wrapped success multisig certificates from proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async () => rpcResult({
        Success: {
          ...certificate,
          envelope: {
            ...certificate.envelope,
            signature: { MultiSig: {} },
          },
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects certificates with short envelope signatures from proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async () => rpcResult({
        Success: {
          ...certificate,
          envelope: {
            ...certificate.envelope,
            signature: { Signature: [7] },
          },
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects certificates with short verifier signature pairs from proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async () => rpcResult({
        Success: {
          ...certificate,
          signatures: [
            [[1], [2]],
          ],
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects multisig certificates with short authorized signer ids from proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async () => rpcResult({
        Success: {
          ...certificate,
          envelope: {
            ...certificate.envelope,
            signature: {
              MultiSig: {
                config: {
                  authorized_signers: [[1]],
                  quorum: 1,
                  nonce: 0,
                },
                signatures: [
                  [new Array(32).fill(1), new Array(64).fill(2)],
                ],
              },
            },
          },
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects multisig certificates with short signature pairs from proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async () => rpcResult({
        Success: {
          ...certificate,
          envelope: {
            ...certificate.envelope,
            signature: {
              MultiSig: {
                config: {
                  authorized_signers: [new Array(32).fill(1)],
                  quorum: 1,
                  nonce: 0,
                },
                signatures: [
                  [[1], [2]],
                ],
              },
            },
          },
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects malformed incomplete verifier signature results from proxy_submitTransaction', async () => {
      globalThis.fetch = async () => rpcResult({
        IncompleteVerifierSigs: 'oops',
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.match(error.message, /Unexpected proxy_submitTransaction result/);
          return true;
        },
      );
    });

    it('rejects certificates with unsafe transaction numbers from proxy_submitTransaction', async () => {
      const certificate = sampleCertificate(9);
      globalThis.fetch = async () => rpcResult({
        ...certificate,
        envelope: {
          ...certificate.envelope,
          transaction: {
            Release20260319: {
              ...certificate.envelope.transaction.Release20260319,
              nonce: 9007199254740992,
            },
          },
        },
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.submitTransaction({
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
        }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          return true;
        },
      );
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

    it('rejects unsafe nonce inputs when fetching transaction certificates', async () => {
      let rpcCalled = false;
      globalThis.fetch = async () => {
        rpcCalled = true;
        throw new Error('RPC should not be called for invalid nonce inputs');
      };

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getTransactionCertificates(VALID_FAST_ADDRESS, 9007199254740992, 1),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'INVALID_PARAMS');
          assert.match(error.message, /Invalid nonce/);
          assert.match(error.note, /safe integer nonce/i);
          return true;
        },
      );
      assert.equal(rpcCalled, false);
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

  describe('getAccountInfo (mocked)', () => {
    it('rejects array payloads in account info responses', async () => {
      globalThis.fetch = async () => rpcResult([]);

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects malformed requested_certificates in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        requested_certificates: [
          {
            envelope: {},
            signatures: [],
          },
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects malformed token_balance entries in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        token_balance: [
          ['not-bytes', '0xf4240'],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects token_balance entries with invalid byte values in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        token_balance: [
          [[256], '0xf4240'],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects token_balance entries with short token ids in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        token_balance: [
          [[1], '0xf4240'],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects malformed next_nonce values in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        next_nonce: '7',
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects unsafe next_nonce values in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        next_nonce: 9007199254740992,
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects malformed balance hex strings in account info responses', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: 'not-hex',
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getAccountInfo(VALID_FAST_ADDRESS),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned account info that could not be decoded.',
          );
          return true;
        },
      );
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
      const info = await provider.getTokenInfo('fastUSDC');
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
      const admin = [1, 2, 3, 4, ...new Array(28).fill(0)];
      const minterA = [5, 6, 7, 8, ...new Array(28).fill(0)];
      const minterB = [9, 10, 11, 12, ...new Array(28).fill(0)];

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
                admin,
                mints: [minterA, minterB],
              },
            ],
          ],
        });
      };

      const provider = new FastProvider();
      const info = await provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46');
      assert.ok(info);
      assert.equal(info.admin, `0x${'01020304'}${'00'.repeat(28)}`);
      assert.deepEqual(info.minters, [
        `0x${'05060708'}${'00'.repeat(28)}`,
        `0x${'090a0b0c'}${'00'.repeat(28)}`,
      ]);
    });

    it('rejects malformed token metadata responses', async () => {
      globalThis.fetch = async () => rpcResult({
        requested_token_metadata: 'oops',
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46'),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned token metadata that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects array metadata entries in token metadata responses', async () => {
      globalThis.fetch = async () => rpcResult({
        requested_token_metadata: [
          [TEST_USDC_TOKEN_ID, []],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46'),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned token metadata that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects token metadata responses with short token ids', async () => {
      globalThis.fetch = async () => rpcResult({
        requested_token_metadata: [
          [[1], { token_name: 'bad', decimals: 6 }],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46'),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned token metadata that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects token metadata responses with short admin addresses', async () => {
      globalThis.fetch = async () => rpcResult({
        requested_token_metadata: [
          [TEST_USDC_TOKEN_ID, { token_name: 'bad', decimals: 6, admin: [1] }],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46'),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned token metadata that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects token metadata responses with short minter addresses', async () => {
      globalThis.fetch = async () => rpcResult({
        requested_token_metadata: [
          [TEST_USDC_TOKEN_ID, { token_name: 'bad', decimals: 6, mints: [[2]] }],
        ],
      });

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getTokenInfo('0xd73a0679a2be46981e2a8aedecd951c8b6690e7d5f8502b34ed3ff4cc2163b46'),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned token metadata that could not be decoded.',
          );
          return true;
        },
      );
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
        () => wallet.send({ to: VALID_FAST_ADDRESS, amount: '1', token: 'fastUSDC' }),
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

    it('does not mislabel malformed success certificates as submission failures', async () => {
      const provider = new FastProvider();
      const wallet = await FastWallet.generate(provider);

      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method: string };

        if (body.method === 'proxy_getAccountInfo') {
          return rpcResult({ next_nonce: 7 });
        }

        if (body.method === 'proxy_submitTransaction') {
          return rpcResult({
            Success: {
              envelope: {},
              signatures: [],
            },
          });
        }

        throw new Error(`Unexpected RPC method: ${body.method}`);
      };

      await assert.rejects(
        () => wallet.send({ to: VALID_FAST_ADDRESS, amount: '1' }),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'Transaction was submitted, but the returned certificate could not be decoded.',
          );
          assert.match(error.note, /may have accepted this transaction/i);
          return true;
        },
      );
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

    it('rejects malformed certificates returned by the certificate listing RPC', async () => {
      globalThis.fetch = async () => rpcResult([
        {
          envelope: {},
          signatures: [],
        },
      ]);

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getCertificateByNonce(VALID_FAST_ADDRESS, 7),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'TX_FAILED');
          assert.equal(
            error.message,
            'The proxy returned a transaction certificate that could not be decoded.',
          );
          return true;
        },
      );
    });

    it('rejects unsafe nonce inputs before querying certificates by nonce', async () => {
      let rpcCalled = false;
      globalThis.fetch = async () => {
        rpcCalled = true;
        throw new Error('RPC should not be called for invalid nonce inputs');
      };

      const provider = new FastProvider();
      await assert.rejects(
        () => provider.getCertificateByNonce(VALID_FAST_ADDRESS, 9007199254740992),
        (error: unknown) => {
          assert.ok(error instanceof FastError);
          assert.equal(error.code, 'INVALID_PARAMS');
          assert.match(error.message, /Invalid nonce/);
          assert.match(error.note, /safe integer nonce/i);
          return true;
        },
      );
      assert.equal(rpcCalled, false);
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
