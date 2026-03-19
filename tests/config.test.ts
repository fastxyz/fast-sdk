import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getConfigDir, getKeysDir } from '../src/config/paths.js';
import {
  getNetworkInfo,
  getAllNetworks,
  resolveKnownFastToken,
  getAllTokens,
  getDefaultRpcUrl,
  getExplorerUrl,
  clearDefaultsCache,
} from '../src/config/file-loader.js';

describe('config', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  before(async () => {
    originalConfigDir = process.env.FAST_CONFIG_DIR;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-config-test-'));
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

  describe('getConfigDir', () => {
    it('returns tmpDir when FAST_CONFIG_DIR is set', () => {
      assert.equal(getConfigDir(), tmpDir);
    });
  });

  describe('getKeysDir', () => {
    it('returns path.join(tmpDir, "keys")', () => {
      assert.equal(getKeysDir(), path.join(tmpDir, 'keys'));
    });
  });
});

describe('defaults', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  before(async () => {
    originalConfigDir = process.env.FAST_CONFIG_DIR;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-defaults-test-'));
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

  describe('getNetworkInfo', () => {
    it('returns testnet config', async () => {
      const info = await getNetworkInfo('testnet');
      assert.ok(info);
      assert.ok(info.rpc.includes('fast.xyz'));
      assert.ok(info.explorer);
    });

    it('returns mainnet config', async () => {
      const info = await getNetworkInfo('mainnet');
      assert.ok(info);
      assert.ok(info.rpc);
      assert.ok(info.explorer);
    });

    it('returns null for unknown network', async () => {
      const info = await getNetworkInfo('unknown-network');
      assert.equal(info, null);
    });
  });

  describe('getAllNetworks', () => {
    it('returns at least testnet and mainnet', async () => {
      const networks = await getAllNetworks();
      assert.ok('testnet' in networks);
      assert.ok('mainnet' in networks);
    });
  });

  describe('resolveKnownFastToken', () => {
    it('resolves FAST token (case-insensitive)', async () => {
      const fast = await resolveKnownFastToken('FAST');
      assert.ok(fast);
      assert.equal(fast.symbol, 'FAST');
      assert.equal(fast.decimals, 18);

      const fastLower = await resolveKnownFastToken('fast');
      assert.deepEqual(fastLower, fast);
    });

    it('resolves testUSDC token (case-insensitive)', async () => {
      const usdc = await resolveKnownFastToken('testUSDC');
      assert.ok(usdc);
      assert.equal(usdc.symbol, 'testUSDC');
      assert.equal(usdc.decimals, 6);
      assert.ok(usdc.tokenId.startsWith('0x'));

      const usdcUpper = await resolveKnownFastToken('TESTUSDC');
      assert.deepEqual(usdcUpper, usdc);
    });

    it('keeps token aliases scoped to the selected network', async () => {
      const mainnetUsdc = await resolveKnownFastToken('fastUSDC', 'mainnet');
      assert.ok(mainnetUsdc);
      assert.equal(mainnetUsdc.symbol, 'fastUSDC');

      const testnetFastUsdc = await resolveKnownFastToken('fastUSDC', 'testnet');
      assert.equal(testnetFastUsdc, null);

      const mainnetTestUsdc = await resolveKnownFastToken('testUSDC', 'mainnet');
      assert.equal(mainnetTestUsdc, null);
    });

    it('returns null for unknown token', async () => {
      const unknown = await resolveKnownFastToken('UNKNOWN_TOKEN');
      assert.equal(unknown, null);
    });
  });

  describe('getAllTokens', () => {
    it('returns at least FAST and TESTUSDC', async () => {
      const tokens = await getAllTokens();
      assert.ok('FAST' in tokens);
      assert.ok('TESTUSDC' in tokens);
    });

    it('returns network-specific bundled token maps', async () => {
      const testnetTokens = await getAllTokens('testnet');
      assert.ok('TESTUSDC' in testnetTokens);
      assert.ok(!('FASTUSDC' in testnetTokens));

      const mainnetTokens = await getAllTokens('mainnet');
      assert.ok('FASTUSDC' in mainnetTokens);
      assert.ok(!('TESTUSDC' in mainnetTokens));
    });
  });

  describe('getDefaultRpcUrl', () => {
    it('returns testnet RPC by default', async () => {
      const url = await getDefaultRpcUrl();
      assert.ok(url.includes('fast.xyz'));
    });

    it('returns mainnet RPC when specified', async () => {
      const url = await getDefaultRpcUrl('mainnet');
      assert.ok(url.includes('fast.xyz'));
    });
  });

  describe('getExplorerUrl', () => {
    it('returns explorer URL', async () => {
      const url = await getExplorerUrl();
      assert.ok(url.includes('fast.xyz') || url.includes('explorer'));
    });
  });

  describe('user overrides', () => {
    before(async () => {
      clearDefaultsCache();
      // Write user override files
      await fs.writeFile(
        path.join(tmpDir, 'networks.json'),
        JSON.stringify({
          custom: {
            rpc: 'https://custom.example.com',
            explorer: 'https://custom-explorer.example.com',
          },
        })
      );
      await fs.writeFile(
        path.join(tmpDir, 'tokens.json'),
        JSON.stringify({
          testnet: {
            CUSTOMTOKEN: {
              symbol: 'CUSTOM',
              tokenId: '0x1234567890abcdef',
              decimals: 18,
            },
          },
        })
      );
    });

    after(async () => {
      clearDefaultsCache();
    });

    it('loads custom network from user override', async () => {
      const info = await getNetworkInfo('custom');
      assert.ok(info);
      assert.equal(info.rpc, 'https://custom.example.com');
      assert.equal(info.explorer, 'https://custom-explorer.example.com');
    });

    it('loads custom token from user override', async () => {
      const token = await resolveKnownFastToken('CUSTOMTOKEN');
      assert.ok(token);
      assert.equal(token.symbol, 'CUSTOM');
      assert.equal(token.decimals, 18);
    });

    it('user overrides do not remove bundled defaults', async () => {
      const testnet = await getNetworkInfo('testnet');
      assert.ok(testnet);

      const fast = await resolveKnownFastToken('FAST');
      assert.ok(fast);
    });
  });
});
