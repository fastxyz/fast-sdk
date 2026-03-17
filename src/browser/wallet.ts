/**
 * wallet.ts — Browser-safe FastWallet class
 *
 * Wallet for signing transactions on the Fast network.
 * No file I/O, no Node dependencies. Works in browsers.
 *
 * Key differences from Node FastWallet:
 * - No fromKeyfile() or saveToKeyfile() (no file system access)
 * - Exposes privateKey getter so users can persist keys themselves
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import {
  BaseWallet,
  validatePrivateKey,
  pubkeyToAddress,
  bytesToHex,
  hexToBytes,
  type WalletSigner,
} from '../core/wallet-base.js';
import { FastProvider } from './provider.js';

// Configure @noble/ed25519 for synchronous hashing
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const combined = msgs.length === 1
    ? msgs[0]
    : new Uint8Array(msgs.reduce((acc, m) => {
        const r = new Uint8Array(acc.length + m.length);
        r.set(acc);
        r.set(m, acc.length);
        return r;
      }, new Uint8Array(0)));
  return sha512(combined);
};

// ─── Browser Signer ───────────────────────────────────────────────────────────

/**
 * Browser-safe signer using @noble/ed25519
 */
class BrowserSigner implements WalletSigner {
  constructor(private privateKey: string) {}

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const privKeyBytes = hexToBytes(this.privateKey);
    return ed.signAsync(message, privKeyBytes);
  }

  async verify(signature: Uint8Array, message: Uint8Array, publicKey: string): Promise<boolean> {
    const pubKeyBytes = hexToBytes(publicKey);
    return ed.verifyAsync(signature, message, pubKeyBytes);
  }
}

// ─── Browser FastWallet ───────────────────────────────────────────────────────

/**
 * Browser-safe FastWallet — Wallet for signing transactions on the Fast network.
 *
 * Unlike the Node FastWallet, this class:
 * - Does NOT support keyfile operations (no file system access)
 * - Exposes privateKey so you can persist it yourself
 *
 * @example
 * ```ts
 * import { FastProvider, FastWallet } from '@fastxyz/sdk/browser';
 *
 * const provider = new FastProvider({ network: 'testnet' });
 *
 * // Generate new wallet
 * const wallet = await FastWallet.generate(provider);
 * console.log(wallet.address);     // fast1...
 * console.log(wallet.privateKey);  // Save this!
 *
 * // From existing key
 * const wallet = await FastWallet.fromPrivateKey('0xabc...', provider);
 *
 * // Send tokens
 * const tx = await wallet.send({ to: 'fast1...', amount: '10', token: 'testUSDC' });
 * ```
 */
export class FastWallet extends BaseWallet {
  private _privateKey: string;

  private constructor(
    provider: FastProvider,
    address: string,
    publicKey: string,
    privateKey: string
  ) {
    super(provider, address, publicKey, new BrowserSigner(privateKey));
    this._privateKey = privateKey;
  }

  /**
   * Create a wallet from a private key (hex string).
   *
   * @param privateKey - 32-byte private key as hex string (with or without 0x prefix)
   * @param provider - FastProvider instance
   */
  static async fromPrivateKey(privateKey: string, provider: FastProvider): Promise<FastWallet> {
    const cleanKey = validatePrivateKey(privateKey);

    // Derive public key and address from private key
    const privKeyBytes = hexToBytes(cleanKey);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBytes);
    const publicKey = bytesToHex(pubKeyBytes);
    const address = pubkeyToAddress(publicKey);

    return new FastWallet(provider, address, publicKey, cleanKey);
  }

  /**
   * Generate a new random wallet.
   *
   * The wallet exists only in memory. Use the `privateKey` getter to
   * retrieve the key and persist it yourself (e.g., localStorage, secure storage).
   *
   * @param provider - FastProvider instance
   */
  static async generate(provider: FastProvider): Promise<FastWallet> {
    const privKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(privKeyBytes);
    
    const privateKey = bytesToHex(privKeyBytes);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBytes);
    const publicKey = bytesToHex(pubKeyBytes);
    const address = pubkeyToAddress(publicKey);

    return new FastWallet(provider, address, publicKey, privateKey);
  }

  /**
   * The wallet's private key (hex string without 0x prefix).
   *
   * Use this to persist the wallet. Store securely!
   */
  get privateKey(): string {
    return this._privateKey;
  }
}
