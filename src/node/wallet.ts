/**
 * wallet.ts — Node FastWallet class
 *
 * Wallet for signing transactions on the Fast network.
 * Supports keyfile storage and management.
 */

import path from 'node:path';
import { FastError } from '../core/errors.js';
import {
  BaseWallet,
  validatePrivateKey,
  pubkeyToAddress,
  bytesToHex,
  hexToBytes,
  type WalletSigner,
} from '../core/wallet-base.js';
import { FastProvider } from './provider.js';
import { getKeysDir } from '../config/paths.js';
import {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  withKey,
  signEd25519,
  verifyEd25519,
} from './keys.js';
import { expandHome } from './utils.js';
import type { WalletKeyfileOptions } from '../core/types.js';

// ─── Node Signers ─────────────────────────────────────────────────────────────

/**
 * Signer that uses an in-memory keypair
 */
class InMemorySigner implements WalletSigner {
  constructor(private privateKey: string) {}

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return signEd25519(message, this.privateKey);
  }

  async verify(signature: Uint8Array, message: Uint8Array, publicKey: string): Promise<boolean> {
    return verifyEd25519(signature, message, publicKey);
  }
}

/**
 * Signer that loads the key from a keyfile for each operation
 */
class KeyfileSigner implements WalletSigner {
  constructor(private keyfilePath: string) {}

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return withKey(this.keyfilePath, async (keypair) => {
      return signEd25519(message, keypair.privateKey);
    });
  }

  async verify(signature: Uint8Array, message: Uint8Array, publicKey: string): Promise<boolean> {
    return verifyEd25519(signature, message, publicKey);
  }
}

// ─── Node FastWallet ──────────────────────────────────────────────────────────

/**
 * FastWallet — Wallet for signing transactions on the Fast network.
 *
 * Supports keyfile storage for persistent wallet management.
 *
 * @example
 * ```ts
 * const provider = new FastProvider({ network: 'testnet' });
 * const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
 * await wallet.send({ to: 'fast1...', amount: '10', token: 'fastUSDC' });
 * ```
 */
export class FastWallet extends BaseWallet {
  private _keyfilePath: string;
  private _inMemoryKeypair?: { publicKey: string; privateKey: string };

  private constructor(
    provider: FastProvider,
    address: string,
    publicKey: string,
    signer: WalletSigner,
    keyfilePath: string,
    inMemoryKeypair?: { publicKey: string; privateKey: string }
  ) {
    super(provider, address, publicKey, signer);
    this._keyfilePath = keyfilePath;
    this._inMemoryKeypair = inMemoryKeypair;
  }

  /**
   * Create a wallet from a private key (hex string).
   *
   * @param privateKey - 32-byte private key as hex string
   * @param provider - FastProvider instance
   */
  static async fromPrivateKey(privateKey: string, provider: FastProvider): Promise<FastWallet> {
    const cleanKey = validatePrivateKey(privateKey);

    // Derive public key and address from private key
    const { getPublicKey } = await import('@noble/ed25519');
    const privKeyBytes = hexToBytes(cleanKey);
    const pubKeyBytes = await getPublicKey(privKeyBytes);
    const publicKey = bytesToHex(pubKeyBytes);
    const address = pubkeyToAddress(publicKey);

    const keypair = { publicKey, privateKey: cleanKey };
    return new FastWallet(
      provider,
      address,
      publicKey,
      new InMemorySigner(cleanKey),
      '',
      keypair
    );
  }

  /**
   * Create a wallet from a keyfile.
   * If the keyfile doesn't exist and createIfMissing is true (default), generates a new key.
   *
   * @param pathOrOpts - Path to keyfile or options object
   * @param provider - FastProvider instance
   */
  static async fromKeyfile(
    pathOrOpts: string | WalletKeyfileOptions,
    provider: FastProvider
  ): Promise<FastWallet> {
    let keyfilePath: string;
    let createIfMissing = true;

    if (typeof pathOrOpts === 'string') {
      keyfilePath = expandHome(pathOrOpts);
    } else {
      createIfMissing = pathOrOpts.createIfMissing ?? true;
      if (pathOrOpts.keyFile) {
        keyfilePath = expandHome(pathOrOpts.keyFile);
      } else {
        const keyName = pathOrOpts.key ?? 'default';
        keyfilePath = path.join(getKeysDir(), `${keyName}.json`);
      }
    }

    let publicKey: string;

    try {
      const existing = await loadKeyfile(keyfilePath);
      publicKey = existing.publicKey;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ENOENT')) {
        throw error;
      }
      if (!createIfMissing) {
        throw new FastError('KEYFILE_NOT_FOUND', `Keyfile not found: ${keyfilePath}`, {
          note: 'Create a keyfile first with FastWallet.generate() or set createIfMissing: true.',
        });
      }
      // Generate new key
      const keypair = await generateEd25519Key();
      await saveKeyfile(keyfilePath, keypair);
      publicKey = keypair.publicKey;
    }

    const address = pubkeyToAddress(publicKey);
    return new FastWallet(
      provider,
      address,
      publicKey,
      new KeyfileSigner(keyfilePath),
      keyfilePath
    );
  }

  /**
   * Generate a new random wallet.
   * Does NOT save to disk — call saveToKeyfile() to persist.
   *
   * @param provider - FastProvider instance
   */
  static async generate(provider: FastProvider): Promise<FastWallet> {
    const keypair = await generateEd25519Key();
    const address = pubkeyToAddress(keypair.publicKey);

    return new FastWallet(
      provider,
      address,
      keypair.publicKey,
      new InMemorySigner(keypair.privateKey),
      '',
      keypair
    );
  }

  /**
   * Save the wallet's keys to a keyfile.
   * Useful after calling FastWallet.generate().
   *
   * @param keyfilePath - Path to save the keyfile
   */
  async saveToKeyfile(keyfilePath: string): Promise<void> {
    if (!this._inMemoryKeypair) {
      throw new FastError('UNSUPPORTED_OPERATION', 'Wallet was not generated in-memory', {
        note: 'Only wallets created with FastWallet.generate() or FastWallet.fromPrivateKey() can be saved.',
      });
    }
    const expandedPath = expandHome(keyfilePath);
    await saveKeyfile(expandedPath, this._inMemoryKeypair);
    this._keyfilePath = expandedPath;
  }
}
