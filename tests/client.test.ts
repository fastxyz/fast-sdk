import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FastProvider, FastWallet } from '../src/index.js';
import { FastError } from '../src/errors.js';
import { clearDefaultsCache } from '../src/defaults.js';
import type { FastTransactionCertificate } from '../src/index.js';

let tmpDir: string;
let originalConfigDir: string | undefined;
const originalFetch = globalThis.fetch;
const VALID_FAST_ADDRESS = 'fast1424242424242424242424242424242424242424242424242424qlc29x9';
// testUSDC token ID on staging
const FAST_USDC_TOKEN_ID = [156, 82, 254, 148, 101, 245, 123, 197, 38, 193, 26, 160, 192, 72, 253, 135, 9, 170, 70, 171, 192, 109, 21, 200, 12, 190, 217, 38, 61, 77, 77, 248] as const;

function rpcResult(result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
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
          [FAST_USDC_TOKEN_ID, '0xf4240'], // 1.0 USDC (1_000_000 with 6 decimals)
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

    it('uses live token decimals for symbol balances when config is stale', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'tokens.json'),
        JSON.stringify({ testnet: { TESTUSDC: { symbol: 'testUSDC', tokenId: '0x9c52fe9465f57bc526c11aa0c048fd8709aa46abc06d15c80cbed9263d4d4df8', decimals: 18 } } })
      );
      clearDefaultsCache();

      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === 'proxy_getAccountInfo') {
          return rpcResult({
            balance: '0x0',
            token_balance: [[FAST_USDC_TOKEN_ID, '0xf4240']],
          });
        }
        if (body.method === 'proxy_getTokenInfo') {
          return rpcResult({
            requested_token_metadata: [
              [FAST_USDC_TOKEN_ID, { token_name: 'testUSDC', decimals: 6 }],
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
              [FAST_USDC_TOKEN_ID, '0xf4240'], // 1.0 USDC
            ],
          });
        }
        // Token info
        return rpcResult({
          requested_token_metadata: [
            [FAST_USDC_TOKEN_ID, { token_name: 'testUSDC', decimals: 6 }],
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
      assert.equal(info.decimals, 9);
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
              FAST_USDC_TOKEN_ID,
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
      const info = await provider.getTokenInfo('0x9c52fe9465f57bc526c11aa0c048fd8709aa46abc06d15c80cbed9263d4d4df8');
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
        JSON.stringify({ testnet: { TESTUSDC: { symbol: 'testUSDC', tokenId: '0x9c52fe9465f57bc526c11aa0c048fd8709aa46abc06d15c80cbed9263d4d4df8', decimals: 18 } } })
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
              Release20260303?: {
                claim?: {
                  TokenTransfer?: {
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
              [FAST_USDC_TOKEN_ID, { token_name: 'testUSDC', decimals: 6 }],
            ],
          });
        }

        if (body.method === 'proxy_getAccountInfo') {
          return rpcResult({ next_nonce: 7 });
        }

        if (body.method === 'proxy_submitTransaction') {
          assert.equal(body.params.transaction?.Release20260303?.claim?.TokenTransfer?.amount, 'f4240');
          return rpcResult({ Success: { certificate: 'ok' } });
        }

        throw new Error(`Unexpected RPC method: ${body.method}`);
      };

      const tx = await wallet.send({ to: VALID_FAST_ADDRESS, amount: '1', token: 'testUSDC' });
      assert.ok(sawTokenInfo);
      assert.ok(tx.txHash);
      assert.deepEqual(tx.certificate, { certificate: 'ok' } as unknown as FastTransactionCertificate);
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
                Release20260303?: {
                  timestamp_nanos?: number;
                };
              };
            };
          };

          if (body.method === 'proxy_getAccountInfo') {
            return rpcResult({ next_nonce: 7 });
          }

          if (body.method === 'proxy_submitTransaction') {
            assert.match(rawBody, new RegExp(`"timestamp_nanos":${expectedTimestamp}`));
            assert.equal(
              body.params.transaction?.Release20260303?.timestamp_nanos?.toString(),
              expectedTimestamp,
            );
            return rpcResult({ Success: { certificate: 'ok' } });
          }

          throw new Error(`Unexpected RPC method: ${body.method}`);
        };

        const tx = await wallet.send({ to: VALID_FAST_ADDRESS, amount: '1' });
        assert.ok(tx.txHash);
        assert.deepEqual(tx.certificate, { certificate: 'ok' } as unknown as FastTransactionCertificate);
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
  });

  describe('getCertificateByNonce', () => {
    it('returns the requested certificate for a nonce', async () => {
      const certificate = {
        envelope: {
          transaction: {
            Release20260303: {
              sender: new Array(32).fill(0),
              recipient: new Array(32).fill(0),
              nonce: 7,
              timestamp_nanos: 1,
              claim: {
                TokenTransfer: {
                  token_id: new Array(32).fill(0),
                  amount: '1',
                  user_data: null,
                },
              },
              archival: false,
            },
          },
          signature: { Signature: [] },
        },
        signatures: [],
      } as FastTransactionCertificate;

      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: { certificate_by_nonce?: { start: number; end: number } | null };
        };
        assert.equal(body.method, 'proxy_getAccountInfo');
        assert.deepEqual(body.params.certificate_by_nonce, { start: 7, end: 7 });
        return rpcResult({ requested_certificates: [certificate] });
      };

      const provider = new FastProvider();
      const result = await provider.getCertificateByNonce(VALID_FAST_ADDRESS, 7);
      assert.deepEqual(result, certificate);
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
