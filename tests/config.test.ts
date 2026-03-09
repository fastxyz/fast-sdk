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
  getNetworkConfig,
  setNetworkConfig,
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
    it('returns { networks: {} } when no config file exists', async () => {
      const config = await loadConfig();
      assert.deepEqual(config, { networks: {} });
    });
  });

  describe('saveConfig / loadConfig roundtrip', () => {
    it('saves and loads config with deep equality', async () => {
      const config = {
        networks: {
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

  describe('setNetworkConfig / getNetworkConfig', () => {
    it('getNetworkConfig returns null for a nonexistent network', async () => {
      const result = await getNetworkConfig('nonexistent');
      assert.equal(result, null);
    });

    it('setNetworkConfig persists and getNetworkConfig retrieves the config', async () => {
      const networkCfg = {
        rpc: 'https://example.com',
        keyfile: '/tmp/k.json',
        network: 'testnet',
        defaultToken: 'SET',
      };
      await setNetworkConfig('fast', networkCfg);
      const result = await getNetworkConfig('fast');
      assert.deepEqual(result, networkCfg);
    });
  });

  describe('config accumulation', () => {
    it('setting two networks preserves both in the loaded config', async () => {
      const netCfgA = {
        rpc: 'https://a.example.com',
        keyfile: '/tmp/a.json',
        network: 'testnet',
        defaultToken: 'SET',
      };
      const netCfgB = {
        rpc: 'https://b.example.com',
        keyfile: '/tmp/b.json',
        network: 'mainnet',
        defaultToken: 'ETH',
      };
      await setNetworkConfig('a', netCfgA);
      await setNetworkConfig('b', netCfgB);

      const loaded = await loadConfig();
      assert.ok('a' in loaded.networks);
      assert.ok('b' in loaded.networks);

      const resultA = await getNetworkConfig('a');
      const resultB = await getNetworkConfig('b');
      assert.deepEqual(resultA, netCfgA);
      assert.deepEqual(resultB, netCfgB);
    });
  });
});
