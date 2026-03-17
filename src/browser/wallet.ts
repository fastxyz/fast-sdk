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
import { FastError } from '../core/errors.js';
import { FastProvider } from './provider.js';
import {
  TransactionBcs,
  serializeVersionedTransaction,
  hashTransaction,
  FAST_DECIMALS,
  FAST_TOKEN_ID,
  hexToTokenId,
} from '../core/bcs.js';
import { pubkeyToAddress, addressToPubkey } from '../core/address.js';
import { bytesToHex, hexToBytes, stripHexPrefix, utf8ToBytes } from '../core/bytes.js';
import { toHex } from '../core/amounts.js';
import type {
  SendResult,
  SignResult,
  SubmitResult,
  ExportedKeys,
  TokenBalance,
} from '../core/types.js';

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

const DEFAULT_TOKEN = 'FAST';
const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

type RpcErrorPayload = {
  message?: string;
  code?: number;
};

function isNativeFastToken(token: string): boolean {
  return token.toUpperCase() === 'FAST';
}

function parseRpcErrorPayload(rawMessage: string): RpcErrorPayload | null {
  const prefix = 'RPC error:';
  if (!rawMessage.startsWith(prefix)) {
    return null;
  }
  const jsonPart = rawMessage.slice(prefix.length).trim();
  if (!jsonPart) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonPart) as RpcErrorPayload;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeProxyErrorMessage(rawMessage: string, fallback: string): string {
  const rpcError = parseRpcErrorPayload(rawMessage);
  let message = (rpcError?.message ?? rawMessage).replace(/\s+/g, ' ').trim();
  const idx = message.indexOf('file:///');
  if (idx !== -1) {
    message = message.slice(0, idx).trim();
    if (message.endsWith(' at')) {
      message = message.slice(0, -3).trim();
    }
  }
  if (!message || message.length < 5) {
    return fallback;
  }
  return message;
}

function mapSubmissionError(
  err: unknown,
  opts: { insufficientNote: string; txFailedNote: string; txFailedFallbackMessage: string }
): FastError {
  if (err instanceof FastError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('insufficient')) {
    return new FastError('INSUFFICIENT_BALANCE', message, { note: opts.insufficientNote });
  }
  if (lower.includes('nonce')) {
    return new FastError('TX_FAILED', `Nonce conflict: ${message}`, { note: opts.txFailedNote });
  }
  return new FastError(
    'TX_FAILED',
    sanitizeProxyErrorMessage(message, opts.txFailedFallbackMessage),
    { note: opts.txFailedNote }
  );
}

function decodeFastAddressOrThrow(address: string): Uint8Array {
  try {
    return addressToPubkey(address);
  } catch {
    throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${address}"`, {
      note: 'Pass a valid fast1... bech32m address.',
    });
  }
}

/**
 * Generate a random 32-byte private key (browser-safe)
 */
function generateRandomPrivateKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Sign a message with Ed25519 (browser-safe)
 */
async function signMessage(message: Uint8Array, privateKey: string): Promise<Uint8Array> {
  const privKeyBytes = hexToBytes(privateKey);
  return ed.signAsync(message, privKeyBytes);
}

/**
 * Verify an Ed25519 signature (browser-safe)
 */
async function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: string
): Promise<boolean> {
  const pubKeyBytes = hexToBytes(publicKey);
  return ed.verifyAsync(signature, message, pubKeyBytes);
}

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
export class FastWallet {
  private _provider: FastProvider;
  private _address: string;
  private _keypair: { publicKey: string; privateKey: string };

  private constructor(
    provider: FastProvider,
    address: string,
    keypair: { publicKey: string; privateKey: string }
  ) {
    this._provider = provider;
    this._address = address;
    this._keypair = keypair;
  }

  /**
   * Create a wallet from a private key (hex string).
   *
   * @param privateKey - 32-byte private key as hex string (with or without 0x prefix)
   * @param provider - FastProvider instance
   */
  static async fromPrivateKey(privateKey: string, provider: FastProvider): Promise<FastWallet> {
    const cleanKey = stripHexPrefix(privateKey);
    if (cleanKey.length !== 64) {
      throw new FastError('INVALID_PARAMS', 'Private key must be 32 bytes (64 hex characters)', {
        note: 'Provide a valid Ed25519 private key.',
      });
    }

    // Derive public key and address from private key
    const privKeyBytes = hexToBytes(cleanKey);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBytes);
    const publicKey = bytesToHex(pubKeyBytes);
    const address = pubkeyToAddress(publicKey);

    return new FastWallet(provider, address, { publicKey, privateKey: cleanKey });
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
    const privKeyBytes = generateRandomPrivateKey();
    const privateKey = bytesToHex(privKeyBytes);
    const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBytes);
    const publicKey = bytesToHex(pubKeyBytes);
    const address = pubkeyToAddress(publicKey);

    return new FastWallet(provider, address, { publicKey, privateKey });
  }

  /** The wallet's Fast address (fast1...) */
  get address(): string {
    return this._address;
  }

  /**
   * The wallet's private key (hex string without 0x prefix).
   *
   * Use this to persist the wallet. Store securely!
   */
  get privateKey(): string {
    return this._keypair.privateKey;
  }

  /** The provider this wallet is connected to */
  get provider(): FastProvider {
    return this._provider;
  }

  /**
   * Get balance for this wallet.
   *
   * @param token - Token symbol or hex ID (default: 'FAST')
   */
  async balance(token: string = 'FAST'): Promise<{ amount: string; token: string }> {
    return this._provider.getBalance(this._address, token);
  }

  /**
   * Get all token balances for this wallet.
   */
  async tokens(): Promise<TokenBalance[]> {
    return this._provider.getTokens(this._address);
  }

  /**
   * Send tokens to an address.
   *
   * @param params.to - Recipient Fast address
   * @param params.amount - Amount to send (decimal string)
   * @param params.token - Token symbol or hex ID (default: 'FAST')
   */
  async send(params: { to: string; amount: string; token?: string }): Promise<SendResult> {
    const tok = params.token ?? DEFAULT_TOKEN;
    decodeFastAddressOrThrow(params.to); // Validate recipient

    // Resolve token ID and decimals
    let tokenId: Uint8Array;
    let decimals: number;

    if (isNativeFastToken(tok)) {
      tokenId = FAST_TOKEN_ID;
      decimals = FAST_DECIMALS;
    } else if (HEX_TOKEN_PATTERN.test(tok)) {
      tokenId = hexToTokenId(tok);
      const info = await this._provider.getTokenInfo(tok);
      decimals = info?.decimals ?? FAST_DECIMALS;
    } else {
      const known = await this._provider.resolveKnownToken(tok);
      if (known && known.tokenId !== 'native') {
        const info = await this._provider.getTokenInfo(known.tokenId);
        if (!info || info.tokenId === 'native') {
          throw new FastError('TOKEN_NOT_FOUND', `Token "${tok}" not found on ${this._provider.network}`, {
            note: 'Use a token symbol configured for the selected network or pass a valid hex token ID.',
          });
        }
        tokenId = hexToTokenId(info.tokenId);
        decimals = info.decimals;
      } else {
        throw new FastError('TOKEN_NOT_FOUND', `Token "${tok}" not found`, {
          note: 'Use a known token symbol (FAST, fastUSDC) or a hex token ID.',
        });
      }
    }

    // Convert amount to hex
    const hexAmount = toHex(params.amount, decimals);

    // Build and submit transaction
    const result = await this.submit({
      recipient: params.to,
      claim: {
        TokenTransfer: {
          token_id: tokenId,
          amount: hexAmount,
          user_data: null,
        },
      },
    });

    const explorerUrl = await this._provider.getExplorerUrl(result.txHash);
    return {
      txHash: result.txHash,
      certificate: result.certificate,
      explorerUrl,
    };
  }

  /**
   * Sign a message with the wallet's Ed25519 key.
   *
   * @param params.message - Message to sign (string or bytes)
   */
  async sign(params: { message: string | Uint8Array }): Promise<SignResult> {
    const messageBytes =
      typeof params.message === 'string'
        ? utf8ToBytes(params.message)
        : params.message;

    const signature = await signMessage(messageBytes, this._keypair.privateKey);

    return {
      signature: bytesToHex(signature),
      address: this._address,
      messageBytes: bytesToHex(messageBytes),
    };
  }

  /**
   * Verify an Ed25519 signature against a Fast address.
   *
   * @param params.message - Original message
   * @param params.signature - Hex signature
   * @param params.address - Fast address that signed
   */
  async verify(params: {
    message: string | Uint8Array;
    signature: string;
    address: string;
  }): Promise<{ valid: boolean }> {
    const messageBytes =
      typeof params.message === 'string'
        ? utf8ToBytes(params.message)
        : params.message;

    const sigBytes = hexToBytes(params.signature);
    const pubkey = addressToPubkey(params.address);
    const pubkeyHex = bytesToHex(pubkey);

    const valid = await verifySignature(sigBytes, messageBytes, pubkeyHex);
    return { valid };
  }

  /**
   * Submit a low-level claim to the Fast network.
   *
   * @param params.recipient - Recipient Fast address
   * @param params.claim - Claim object (e.g., { TokenTransfer: { ... } })
   */
  async submit(params: { recipient: string; claim: Record<string, unknown> }): Promise<SubmitResult> {
    const senderPubkey = decodeFastAddressOrThrow(this._address);
    const recipientPubkey = decodeFastAddressOrThrow(params.recipient);

    // Get nonce
    const accountInfo = await this._provider.getAccountInfo(this._address);
    const nonce = (accountInfo as { next_nonce?: number } | null)?.next_nonce ?? 0;

    // Build transaction
    const transaction = {
      sender: senderPubkey,
      recipient: recipientPubkey,
      nonce,
      timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
      claim: params.claim as Parameters<typeof TransactionBcs.serialize>[0]['claim'],
      archival: false,
    };

    // Serialize as VersionedTransaction and create signing message
    const msgHead = new TextEncoder().encode('VersionedTransaction::');
    const msgBody = serializeVersionedTransaction(transaction);
    const msg = new Uint8Array(msgHead.length + msgBody.length);
    msg.set(msgHead, 0);
    msg.set(msgBody, msgHead.length);

    // Sign
    const signature = await signMessage(msg, this._keypair.privateKey);

    // Hash for txHash
    const txHash = hashTransaction(transaction);

    // Submit
    try {
      const submitResult = await this._provider.submitTransaction({
        transaction,
        signature: { Signature: Array.from(signature) },
      });

      if ('IncompleteVerifierSigs' in submitResult) {
        throw new FastError('TX_FAILED', 'Transaction submission is incomplete: missing verifier signatures', {
          note: 'Provide all required verifier signatures before submitting this transaction.',
        });
      }
      if ('IncompleteMultiSig' in submitResult) {
        throw new FastError('TX_FAILED', 'Transaction submission is incomplete: missing multisig signatures', {
          note: 'Provide the required multisig signatures before submitting this transaction.',
        });
      }

      return {
        txHash,
        certificate: submitResult.Success,
      };
    } catch (err: unknown) {
      throw mapSubmissionError(err, {
        insufficientNote: 'Fund your Fast wallet with FAST or fastUSDC, then retry.',
        txFailedNote: 'Wait 5 seconds, then retry.',
        txFailedFallbackMessage: 'Transaction submission failed.',
      });
    }
  }

  /**
   * Export public key and address (never exposes private key via this method).
   */
  async exportKeys(): Promise<ExportedKeys> {
    return {
      publicKey: this._keypair.publicKey,
      address: this._address,
    };
  }
}
