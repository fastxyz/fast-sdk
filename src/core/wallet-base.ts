/**
 * wallet-base.ts — Shared wallet logic (browser-safe)
 *
 * Contains all the common wallet functionality used by both
 * browser/wallet.ts and node/wallet.ts.
 */

import { FastError } from './errors.js';
import { BaseFastProvider } from './provider-base.js';
import {
  TransactionBcs,
  serializeVersionedTransaction,
  hashTransaction,
  FAST_DECIMALS,
  FAST_TOKEN_ID,
  hexToTokenId,
} from './bcs.js';
import { pubkeyToAddress, addressToPubkey } from './address.js';
import { bytesToHex, hexToBytes, stripHexPrefix, utf8ToBytes } from './bytes.js';
import { toHex } from './amounts.js';
import type {
  SendResult,
  SignResult,
  SubmitResult,
  ExportedKeys,
  TokenBalance,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TOKEN = 'FAST';
const HEX_TOKEN_PATTERN = /^(0x)?[0-9a-fA-F]+$/;

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function isNativeFastToken(token: string): boolean {
  return token.toUpperCase() === 'FAST';
}

type RpcErrorPayload = {
  message?: string;
  code?: number;
};

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

export function mapSubmissionError(
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

export function decodeFastAddressOrThrow(address: string): Uint8Array {
  try {
    return addressToPubkey(address);
  } catch {
    throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${address}"`, {
      note: 'Pass a valid fast1... bech32m address.',
    });
  }
}

export function validatePrivateKey(privateKey: string): string {
  const cleanKey = stripHexPrefix(privateKey);
  if (cleanKey.length !== 64) {
    throw new FastError('INVALID_PARAMS', 'Private key must be 32 bytes (64 hex characters)', {
      note: 'Provide a valid Ed25519 private key.',
    });
  }
  return cleanKey;
}

// ─── Signing Interface ────────────────────────────────────────────────────────

/**
 * Interface for signing operations.
 * Implemented differently by browser (inline) and node (keyfile) wallets.
 */
export interface WalletSigner {
  sign(message: Uint8Array): Promise<Uint8Array>;
  verify(signature: Uint8Array, message: Uint8Array, publicKey: string): Promise<boolean>;
}

// ─── Base Wallet Class ────────────────────────────────────────────────────────

/**
 * BaseWallet — Shared wallet functionality for browser and node implementations.
 *
 * Subclasses must implement:
 * - Constructor that sets up _provider, _address, _publicKey, and _signer
 * - Static factory methods (generate, fromPrivateKey, etc.)
 */
export abstract class BaseWallet {
  protected _provider: BaseFastProvider;
  protected _address: string;
  protected _publicKey: string;
  protected _signer: WalletSigner;

  protected constructor(
    provider: BaseFastProvider,
    address: string,
    publicKey: string,
    signer: WalletSigner
  ) {
    this._provider = provider;
    this._address = address;
    this._publicKey = publicKey;
    this._signer = signer;
  }

  /** The wallet's Fast address (fast1...) */
  get address(): string {
    return this._address;
  }

  /** The provider this wallet is connected to */
  get provider(): BaseFastProvider {
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

    const signature = await this._signer.sign(messageBytes);

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

    const valid = await this._signer.verify(sigBytes, messageBytes, pubkeyHex);
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

    // Sign using the signer
    const signature = await this._signer.sign(msg);

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
   * Export public key and address (never exposes private key).
   */
  async exportKeys(): Promise<ExportedKeys> {
    return {
      publicKey: this._publicKey,
      address: this._address,
    };
  }
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { pubkeyToAddress, bytesToHex, hexToBytes, stripHexPrefix };
