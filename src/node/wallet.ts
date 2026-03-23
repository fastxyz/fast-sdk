/**
 * wallet.ts — FastWallet class
 *
 * Wallet for signing transactions on the Fast network.
 * Requires a FastProvider for broadcasting transactions.
 */

import path from 'node:path';
import { FastError } from '../core/errors.js';
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
import {
  TransactionBcs,
  serializeVersionedTransaction,
  FAST_DECIMALS,
  FAST_TOKEN_ID,
  hexToTokenId,
} from '../core/bcs.js';
import { getCertificateHash } from '../core/certificate.js';
import { encodeFastAddress, fastAddressToBytes } from '../core/address.js';
import { bytesToHex, hexToBytes, stripHexPrefix, utf8ToBytes } from '../core/bytes.js';
import { toHex } from '../core/amounts.js';
import { expandHome } from './utils.js';
import type {
  WalletKeyfileOptions,
  SendResult,
  SignResult,
  SubmitResult,
  ExportedKeys,
  TokenBalance,
} from '../core/types.js';

const DEFAULT_TOKEN = 'FAST';
const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

type RpcErrorPayload = {
  message?: string;
  code?: number;
};

function isNativeFastToken(token: string): boolean {
  const upper = token.toUpperCase();
  return upper === 'FAST';
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
    return fastAddressToBytes(address);
  } catch {
    throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${address}"`, {
      note: 'Pass a valid fast1... bech32m address.',
    });
  }
}

/**
 * FastWallet — Wallet for signing transactions on the Fast network.
 *
 * @example
 * ```ts
 * const provider = new FastProvider({ network: 'testnet' });
 * const wallet = await FastWallet.fromKeyfile('~/.fast/keys/default.json', provider);
 * await wallet.send({ to: 'fast1...', amount: '10', token: 'testUSDC' });
 * ```
 */
export class FastWallet {
  private _provider: FastProvider;
  private _keyfilePath: string;
  private _address: string;
  private _inMemoryKeypair?: { publicKey: string; privateKey: string };

  private constructor(
    provider: FastProvider,
    keyfilePath: string,
    address: string,
    inMemoryKeypair?: { publicKey: string; privateKey: string }
  ) {
    this._provider = provider;
    this._keyfilePath = keyfilePath;
    this._address = address;
    this._inMemoryKeypair = inMemoryKeypair;
  }

  /**
   * Create a wallet from a private key (hex string).
   *
   * @param privateKey - 32-byte private key as hex string
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
    const { getPublicKey } = await import('@noble/ed25519');
    const privKeyBytes = hexToBytes(cleanKey);
    const pubKeyBytes = await getPublicKey(privKeyBytes);
    const publicKey = bytesToHex(pubKeyBytes);
    const address = encodeFastAddress(pubKeyBytes);

    // Create wallet with in-memory keypair
    return new FastWallet(provider, '', address, { publicKey, privateKey: cleanKey });
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

    let address: string;

    try {
      const existing = await loadKeyfile(keyfilePath);
      address = encodeFastAddress(hexToBytes(existing.publicKey));
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
      address = encodeFastAddress(hexToBytes(keypair.publicKey));
    }

    return new FastWallet(provider, keyfilePath, address);
  }

  /**
   * Generate a new random wallet.
   * Does NOT save to disk — call saveToKeyfile() to persist.
   *
   * @param provider - FastProvider instance
   */
  static async generate(provider: FastProvider): Promise<FastWallet> {
    const keypair = await generateEd25519Key();
    const address = encodeFastAddress(hexToBytes(keypair.publicKey));

    // Create wallet with in-memory keypair
    return new FastWallet(provider, '', address, keypair);
  }

  /** The wallet's Fast address */
  get address(): string {
    return this._address;
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
    const recipientPubkey = decodeFastAddressOrThrow(params.to);

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
          note: 'Use a token symbol configured for the selected network or pass a valid hex token ID.',
        });
      }
    }

    // Convert amount to hex
    const hexAmount = toHex(params.amount, decimals);

    // Build and submit transaction
    const result = await this.submit({
      claim: {
        TokenTransfer: {
          token_id: tokenId,
          recipient: recipientPubkey,
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

    let signature: Uint8Array;

    if (this._inMemoryKeypair) {
      signature = await signEd25519(messageBytes, this._inMemoryKeypair.privateKey);
    } else {
      signature = await withKey(this._keyfilePath, async (keypair) => {
        return signEd25519(messageBytes, keypair.privateKey);
      });
    }

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
    const pubkey = decodeFastAddressOrThrow(params.address);
    const pubkeyHex = bytesToHex(pubkey);

    // verifyEd25519 signature order: (signature, message, publicKey)
    const valid = await verifyEd25519(sigBytes, messageBytes, pubkeyHex);
    return { valid };
  }

  /**
   * Submit a low-level claim to the Fast network.
   *
   * Claims that require a recipient must include it inside the claim payload
   * (for example `TokenTransfer.recipient`).
   */
  async submit(params: { claim: Record<string, unknown> }): Promise<SubmitResult> {
    const senderPubkey = decodeFastAddressOrThrow(this._address);
    const networkId = await this._provider.getNetworkId();

    // Get nonce
    const accountInfo = await this._provider.getAccountInfo(this._address);
    const nonce = (accountInfo as { next_nonce?: number } | null)?.next_nonce ?? 0;

    // Build transaction
    const transaction = {
      network_id: networkId,
      sender: senderPubkey,
      nonce,
      timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
      claim: params.claim as Parameters<typeof TransactionBcs.serialize>[0]['claim'],
      archival: false,
      fee_token: null,
    };

    // Serialize as VersionedTransaction and create signing message
    const msgHead = new TextEncoder().encode('VersionedTransaction::');
    const msgBody = serializeVersionedTransaction(transaction);
    const msg = new Uint8Array(msgHead.length + msgBody.length);
    msg.set(msgHead, 0);
    msg.set(msgBody, msgHead.length);

    // Sign
    let signature: Uint8Array;

    if (this._inMemoryKeypair) {
      signature = await signEd25519(msg, this._inMemoryKeypair.privateKey);
    } else {
      signature = await withKey(this._keyfilePath, async (keypair) => {
        return signEd25519(msg, keypair.privateKey);
      });
    }

    let submitResult: Awaited<ReturnType<FastProvider['submitTransaction']>>;
    try {
      submitResult = await this._provider.submitTransaction({
        transaction,
        signature: { Signature: Array.from(signature) },
      });
    } catch (err: unknown) {
      throw mapSubmissionError(err, {
        insufficientNote: 'Fund your Fast wallet with FAST or the token you are sending, then retry.',
        txFailedNote: 'Wait 5 seconds, then retry.',
        txFailedFallbackMessage: 'Transaction submission failed.',
      });
    }

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

    const certificate = submitResult.Success;
    let txHash: string;
    try {
      // Compute txHash from the certificate to ensure consistency
      // (the certificate contains the canonical transaction as certified by the network)
      txHash = getCertificateHash(certificate);
    } catch {
      throw new FastError(
        'TX_FAILED',
        'Transaction was submitted, but the returned certificate could not be decoded.',
        {
          note: 'The network may have accepted this transaction. Inspect the returned certificate or upgrade the SDK if the network uses a newer certificate format.',
        },
      );
    }

    return {
      txHash,
      certificate,
    };
  }

  /**
   * Export public key and address (never exposes private key).
   */
  async exportKeys(): Promise<ExportedKeys> {
    if (this._inMemoryKeypair) {
      return {
        publicKey: this._inMemoryKeypair.publicKey,
        address: this._address,
      };
    }

    const keypair = await loadKeyfile(this._keyfilePath);
    return {
      publicKey: keypair.publicKey,
      address: this._address,
    };
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
