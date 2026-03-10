import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FastProvider, FastWallet } from '../src/index.js';
import { FastError } from '../src/errors.js';
import { clearDefaultsCache } from '../src/defaults.js';

let tmpDir: string;
let originalConfigDir: string | undefined;
const originalFetch = globalThis.fetch;
// fastUSDC token ID on staging
const FAST_USDC_TOKEN_ID = [180, 207, 27, 158, 34, 123, 182, 162, 27, 149, 147, 56, 137, 93, 251, 57, 184, 210, 169, 109, 250, 28, 229, 221, 99, 53, 97, 193, 147, 18, 76, 181] as const;

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

afterEach(() => {
  globalThis.fetch = originalFetch;
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
      const balance = await provider.getBalance('fast1424242424242424242424242424242424242424242424242424qlc29x9');
      assert.equal(balance.token, 'FAST');
      assert.equal(balance.amount, '10');
    });

    it('returns 0 for unknown address', async () => {
      globalThis.fetch = async () => rpcResult(null);

      const provider = new FastProvider();
      const balance = await provider.getBalance('fast1424242424242424242424242424242424242424242424242424qlc29x9');
      assert.equal(balance.amount, '0');
    });

    it('returns fastUSDC balance by symbol', async () => {
      globalThis.fetch = async () => rpcResult({
        balance: '0x0',
        token_balance: [
          [FAST_USDC_TOKEN_ID, '0xf4240'], // 1.0 USDC (1_000_000 with 6 decimals)
        ],
      });

      const provider = new FastProvider();
      const balance = await provider.getBalance(
        'fast1424242424242424242424242424242424242424242424242424qlc29x9',
        'fastUSDC'
      );
      assert.equal(balance.token, 'fastUSDC');
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
            [FAST_USDC_TOKEN_ID, { token_name: 'fastUSDC', decimals: 6 }],
          ],
        });
      };

      const provider = new FastProvider();
      const tokens = await provider.getTokens('fast1424242424242424242424242424242424242424242424242424qlc29x9');
      
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
  });

  describe('getExplorerUrl', () => {
    it('returns explorer URL', async () => {
      const provider = new FastProvider();
      const url = await provider.getExplorerUrl();
      assert.ok(url.includes('fast.xyz') || url.includes('explorer'));
    });

    it('returns explorer URL with tx hash', async () => {
      const provider = new FastProvider();
      const url = await provider.getExplorerUrl('abc123');
      assert.ok(url.includes('abc123'));
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

  describe('sign/verify', () => {
    it('signs and verifies message', async () => {
      const provider = new FastProvider();
      const keyfilePath = path.join(tmpDir, 'keys', 'sign-test.json');
      const wallet = await FastWallet.fromKeyfile(keyfilePath, provider);

      const message = 'Hello, Fast!';
      const signed = await wallet.sign({ message });

      assert.ok(signed.signature);
      assert.equal(signed.address, wallet.address);

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
