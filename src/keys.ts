/**
 * keys.ts — Key management for money SDK
 *
 * SECURITY INVARIANT: Private keys MUST NEVER appear in any return value,
 * log, error message, or console output (except the internal generate/load
 * functions that return them for immediate use by withKey).
 */

import { randomBytes } from 'node:crypto';
import { open, readFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { constants } from 'node:fs';
import { expandHome } from './utils.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Required for @noble/ed25519 synchronous hashing in Node.js
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(
  msgs.length === 1 ? msgs[0] : new Uint8Array(msgs.reduce((a, m) => { const r = new Uint8Array(a.length + m.length); r.set(a); r.set(m, a.length); return r; }, new Uint8Array(0)))
);

const PRIVATE_KEY_HEX_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

function normalizeEnvPrivateKey(value: string): string {
  const trimmed = value.trim();
  if (!PRIVATE_KEY_HEX_PATTERN.test(trimmed)) {
    throw new Error('MONEY_FAST_PRIVATE_KEY must be a 32-byte hex string');
  }
  return trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? trimmed.slice(2).toLowerCase()
    : trimmed.toLowerCase();
}

async function keypairFromPrivateKey(
  privateKey: string,
): Promise<{ publicKey: string; privateKey: string }> {
  const normalized = normalizeEnvPrivateKey(privateKey);
  const privKeyBuf = Buffer.from(normalized, 'hex');
  try {
    const publicKey = await ed.getPublicKeyAsync(privKeyBuf);
    return {
      publicKey: Buffer.from(publicKey).toString('hex'),
      privateKey: normalized,
    };
  } finally {
    privKeyBuf.fill(0);
  }
}

async function seedKeyfileFromEnvIfConfigured(keyPath: string): Promise<boolean> {
  const envPrivateKey = process.env.MONEY_FAST_PRIVATE_KEY?.trim();
  if (!envPrivateKey) {
    return false;
  }

  const keypair = await keypairFromPrivateKey(envPrivateKey);
  try {
    await saveKeyfile(keyPath, keypair);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an ed25519 keypair.
 * Internal — callers should prefer withKey().
 */
export async function generateEd25519Key(): Promise<{ publicKey: string; privateKey: string }> {
  const privKeyBuf = randomBytes(32);
  const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBuf);
  const result = {
    publicKey: Buffer.from(pubKeyBytes).toString('hex'),
    privateKey: privKeyBuf.toString('hex'),
  };
  // Zero out the buffer immediately after extraction
  privKeyBuf.fill(0);
  return result;
}

/**
 * Load a keyfile from disk.
 * Expands `~` in the path.
 */
export async function loadKeyfile(
  path: string,
): Promise<{ publicKey: string; privateKey: string }> {
  const resolved = expandHome(path);
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const seeded = await seedKeyfileFromEnvIfConfigured(resolved);
      if (seeded) {
        raw = await readFile(resolved, 'utf-8');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read keyfile at ${resolved}: ${msg}`);
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read keyfile at ${resolved}: ${msg}`);
    }
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string') {
    throw new Error(`Keyfile at ${resolved} is missing publicKey or privateKey fields`);
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

/**
 * Save a keypair to a keyfile.
 * Creates parent directories with mode 0700 and writes the file with mode 0600.
 *
 * Uses O_CREAT | O_WRONLY | O_EXCL so the call **fails** if the file already
 * exists.  This prevents any code path from accidentally overwriting a wallet
 * private key.
 *
 * After writing, a backup copy is created at `<dir>/backups/<name>` so keys
 * can be recovered even if the primary file is accidentally deleted.
 */
export async function saveKeyfile(
  keyPath: string,
  keypair: { publicKey: string; privateKey: string },
): Promise<void> {
  const resolved = expandHome(keyPath);
  const dir = dirname(resolved);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const json = JSON.stringify({ publicKey: keypair.publicKey, privateKey: keypair.privateKey }, null, 2);

  // O_EXCL: fail if file exists — never overwrite a keyfile
  const fd = await open(resolved, constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL, 0o600);
  try {
    await fd.writeFile(json, { encoding: 'utf-8' });
  } finally {
    await fd.close();
  }

  // Write a backup copy (best-effort — don't fail key creation if backup fails)
  try {
    const backupDir = join(dir, 'backups');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = join(backupDir, basename(resolved));
    await copyFile(resolved, backupPath, constants.COPYFILE_EXCL);
    await chmod(backupPath, 0o400);
  } catch {
    // Backup is best-effort; primary keyfile was already written successfully
  }
}

/**
 * Sign a message with ed25519.
 */
export async function signEd25519(message: Uint8Array, privateKeyHex: string): Promise<Uint8Array> {
  const privKeyBuf = Buffer.from(privateKeyHex, 'hex');
  try {
    return await ed.signAsync(message, privKeyBuf);
  } finally {
    privKeyBuf.fill(0);
  }
}

/**
 * Verify an Ed25519 signature.
 * Returns true if the signature is valid for the given message and public key.
 */
export async function verifyEd25519(
  signature: Uint8Array,
  message: Uint8Array,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');
    return await ed.verifyAsync(signature, message, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Load a keypair, run `fn` with it, then zero out the private key from memory.
 * This is the primary way adapters should access keys.
 */
export async function withKey<T>(
  keyfilePath: string,
  fn: (keypair: { publicKey: string; privateKey: string }) => Promise<T>,
): Promise<T> {
  const keypair = await loadKeyfile(keyfilePath);
  const privBuf = Buffer.from(keypair.privateKey, 'hex');
  try {
    return await fn(keypair);
  } finally {
    // Overwrite the private key string's backing store as best we can in JS
    privBuf.fill(0);
    // Replace with zeroed string to drop the reference
    (keypair as { publicKey: string; privateKey: string }).privateKey =
      '0'.repeat(keypair.privateKey.length);
  }
}

// expandHome imported from ./utils.js
