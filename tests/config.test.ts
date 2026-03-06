import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getConfigDir,
  getKeysDir,
  loadConfig,
  saveConfig,
  getChainConfig,
  setChainConfig,
} from '../src/config.js';

describe('config', () => {
  let tmpDir: string;
  let originalConfigDir: string | undefined;

  before(async () => {
    originalConfigDir = process.env.FAST_CONFIG_DIR;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-config-test-'));
    process.env.FAST_CONFIG_DIR = tmpDir;
  });

  after(async () => {
    if (originalConfigDir !== undefined) {
      process.env.FAST_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.FAST_CONFIG_DIR;
    }
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

  describe('loadConfig — no file', () => {
    it('returns { chains: {} } when no config file exists', async () => {
      const config = await loadConfig();
      assert.deepEqual(config, { chains: {} });
    });
  });

  describe('saveConfig / loadConfig roundtrip', () => {
    it('saves and loads config with deep equality', async () => {
      const config = {
        chains: {
          fast: {
            rpc: 'https://example.com',
            keyfile: '/tmp/k.json',
            network: 'testnet',
            defaultToken: 'SET',
          },
        },
      };
      await saveConfig(config);
      const loaded = await loadConfig();
      assert.deepEqual(loaded, config);
    });
  });

  describe('setChainConfig / getChainConfig', () => {
    it('getChainConfig returns null for a nonexistent chain', async () => {
      const result = await getChainConfig('nonexistent');
      assert.equal(result, null);
    });

    it('setChainConfig persists and getChainConfig retrieves the config', async () => {
      const chainCfg = {
        rpc: 'https://example.com',
        keyfile: '/tmp/k.json',
        network: 'testnet',
        defaultToken: 'SET',
      };
      await setChainConfig('fast', chainCfg);
      const result = await getChainConfig('fast');
      assert.deepEqual(result, chainCfg);
    });
  });

  describe('config accumulation', () => {
    it('setting two chains preserves both in the loaded config', async () => {
      const cfgA = {
        rpc: 'https://a.example.com',
        keyfile: '/tmp/a.json',
        network: 'testnet',
        defaultToken: 'SET',
      };
      const cfgB = {
        rpc: 'https://b.example.com',
        keyfile: '/tmp/b.json',
        network: 'mainnet',
        defaultToken: 'ETH',
      };
      await setChainConfig('a', cfgA);
      await setChainConfig('b', cfgB);

      const loaded = await loadConfig();
      assert.ok('a' in loaded.chains);
      assert.ok('b' in loaded.chains);

      const resultA = await getChainConfig('a');
      const resultB = await getChainConfig('b');
      assert.deepEqual(resultA, cfgA);
      assert.deepEqual(resultB, cfgB);
    });
  });
});
