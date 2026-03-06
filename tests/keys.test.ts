import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  signEd25519,
  verifyEd25519,
  withKey,
} from '../src/keys.js';

describe('keys', () => {
  let tmpDir: string;
  let originalFastPrivateKey: string | undefined;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-keys-test-'));
    originalFastPrivateKey = process.env.MONEY_FAST_PRIVATE_KEY;
  });

  after(async () => {
    if (originalFastPrivateKey !== undefined) {
      process.env.MONEY_FAST_PRIVATE_KEY = originalFastPrivateKey;
    } else {
      delete process.env.MONEY_FAST_PRIVATE_KEY;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (originalFastPrivateKey !== undefined) {
      process.env.MONEY_FAST_PRIVATE_KEY = originalFastPrivateKey;
    } else {
      delete process.env.MONEY_FAST_PRIVATE_KEY;
    }
  });

  describe('generateEd25519Key', () => {
    it('returns publicKey and privateKey hex strings', async () => {
      const kp = await generateEd25519Key();
      assert.equal(typeof kp.publicKey, 'string');
      assert.equal(typeof kp.privateKey, 'string');
    });

    it('publicKey is 64 hex chars (32 bytes)', async () => {
      const kp = await generateEd25519Key();
      assert.equal(kp.publicKey.length, 64);
    });

    it('privateKey is 64 hex chars (32 bytes)', async () => {
      const kp = await generateEd25519Key();
      assert.equal(kp.privateKey.length, 64);
    });

    it('two calls produce different keys', async () => {
      const kp1 = await generateEd25519Key();
      const kp2 = await generateEd25519Key();
      assert.notEqual(kp1.publicKey, kp2.publicKey);
      assert.notEqual(kp1.privateKey, kp2.privateKey);
    });
  });

  describe('saveKeyfile / loadKeyfile', () => {
    it('saves and loads a keyfile with matching publicKey and privateKey', async () => {
      const kp = await generateEd25519Key();
      const keyPath = path.join(tmpDir, 'keys', 'test.json');
      await saveKeyfile(keyPath, kp);
      const loaded = await loadKeyfile(keyPath);
      assert.equal(loaded.publicKey, kp.publicKey);
      assert.equal(loaded.privateKey, kp.privateKey);
    });

    it('throws when saving to the same path again (O_EXCL prevents overwrite)', async () => {
      const kp = await generateEd25519Key();
      const keyPath = path.join(tmpDir, 'keys', 'duplicate.json');
      await saveKeyfile(keyPath, kp);
      await assert.rejects(async () => {
        await saveKeyfile(keyPath, kp);
      });
    });
  });

  describe('loadKeyfile errors', () => {
    it('throws when loading from a non-existent path', async () => {
      const missingPath = path.join(tmpDir, 'keys', 'nonexistent.json');
      await assert.rejects(async () => {
        await loadKeyfile(missingPath);
      });
    });

    it('seeds a missing keyfile from MONEY_FAST_PRIVATE_KEY when configured', async () => {
      const seededPath = path.join(tmpDir, 'keys', 'seeded.json');
      process.env.MONEY_FAST_PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';

      const loaded = await loadKeyfile(seededPath);
      const fromDisk = JSON.parse(await fs.readFile(seededPath, 'utf-8')) as {
        publicKey: string;
        privateKey: string;
      };

      assert.equal(loaded.privateKey, '1111111111111111111111111111111111111111111111111111111111111111');
      assert.equal(fromDisk.privateKey, loaded.privateKey);
      assert.equal(fromDisk.publicKey, loaded.publicKey);
      assert.equal(loaded.publicKey.length, 64);
    });
  });

  describe('signEd25519 / verifyEd25519', () => {
    it('signature is a Uint8Array of length 64', async () => {
      const kp = await generateEd25519Key();
      const message = new TextEncoder().encode('hello');
      const sig = await signEd25519(message, kp.privateKey);
      assert.ok(sig instanceof Uint8Array);
      assert.equal(sig.length, 64);
    });

    it('verifies a valid signature with the correct public key', async () => {
      const kp = await generateEd25519Key();
      const message = new TextEncoder().encode('hello');
      const sig = await signEd25519(message, kp.privateKey);
      const valid = await verifyEd25519(sig, message, kp.publicKey);
      assert.equal(valid, true);
    });

    it('returns false when verifying with the wrong message', async () => {
      const kp = await generateEd25519Key();
      const message = new TextEncoder().encode('hello');
      const sig = await signEd25519(message, kp.privateKey);
      const wrongMessage = new TextEncoder().encode('wrong');
      const valid = await verifyEd25519(sig, wrongMessage, kp.publicKey);
      assert.equal(valid, false);
    });

    it('returns false when verifying with a different keypair public key', async () => {
      const kp1 = await generateEd25519Key();
      const kp2 = await generateEd25519Key();
      const message = new TextEncoder().encode('hello');
      const sig = await signEd25519(message, kp1.privateKey);
      const valid = await verifyEd25519(sig, message, kp2.publicKey);
      assert.equal(valid, false);
    });
  });

  describe('withKey', () => {
    it('calls the callback with the loaded keypair and returns its result', async () => {
      const kp = await generateEd25519Key();
      const keyPath = path.join(tmpDir, 'keys', 'withkey.json');
      await saveKeyfile(keyPath, kp);
      const result = await withKey(keyPath, async (loaded) => loaded.publicKey);
      assert.equal(result, kp.publicKey);
    });
  });
});
