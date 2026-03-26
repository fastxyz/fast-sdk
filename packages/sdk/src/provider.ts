import { Address } from './address';
import { hexToTokenId, type FastTransaction } from './bcs';
import { hexToBytes, stripHexPrefix } from './bytes';
import { FastError } from './errors';
import { rpcCall } from './rpc';
import type {
  FastAccountInfo,
  FastSubmitTransactionResult,
  FastTransactionCertificate,
  FastTransactionEnvelope,
  FastVersionedTransaction,
  ProviderOptions,
} from './types';

function toRpcVersionedTransaction(
  transaction: FastVersionedTransaction,
): { Release20260319: FastTransaction } {
  if (transaction && typeof transaction === 'object' && 'Release20260319' in transaction) {
    return transaction as { Release20260319: FastTransaction };
  }

  return { Release20260319: transaction as FastTransaction };
}

function isTransactionCertificate(value: unknown): value is FastTransactionCertificate {
  return Boolean(
    value
    && typeof value === 'object'
    && 'envelope' in value
    && 'signatures' in value,
  );
}

function hexToFixed32(value: string, fieldName: string): Uint8Array {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) {
    throw new FastError('INVALID_PARAMS', `${fieldName} must be exactly 32 bytes`, {
      note: `Pass a 0x-prefixed 32-byte hex string for ${fieldName}.`,
    });
  }
  return bytes;
}

function normalizeMaybeBytes32(value: string | Uint8Array, fieldName: string): Uint8Array {
  if (typeof value === 'string') {
    return hexToFixed32(value, fieldName);
  }
  if (value.length !== 32) {
    throw new FastError('INVALID_PARAMS', `${fieldName} must be exactly 32 bytes`, {
      note: `Pass a 32-byte Uint8Array or hex string for ${fieldName}.`,
    });
  }
  return value;
}

/**
 * FastProvider — isomorphic 1:1 RPC provider for Fast proxy endpoints.
 */
export class FastProvider {
  private readonly _rpcUrl: string;

  constructor(opts: ProviderOptions) {
    if (!opts?.rpcUrl) {
      throw new FastError('INVALID_PARAMS', 'FastProvider requires ProviderOptions.rpcUrl', {
        note: 'Pass the proxy endpoint explicitly, e.g. new FastProvider({ rpcUrl: "https://.../proxy" }).',
      });
    }
    this._rpcUrl = opts.rpcUrl;
  }

  get rpcUrl(): string {
    return this._rpcUrl;
  }

  async submitTransaction(
    envelope: FastTransactionEnvelope,
  ): Promise<FastSubmitTransactionResult> {
    const result = await rpcCall(this._rpcUrl, 'proxy_submitTransaction', {
      transaction: toRpcVersionedTransaction(envelope.transaction),
      signature: envelope.signature,
    });

    if (isTransactionCertificate(result)) {
      return { Success: result };
    }

    if (result && typeof result === 'object') {
      if ('Success' in result || 'IncompleteVerifierSigs' in result || 'IncompleteMultiSig' in result) {
        return result as FastSubmitTransactionResult;
      }
    }

    throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
      note: 'The proxy returned a result that does not match documented submitTransaction variants.',
    });
  }

  async faucetDrip(params: {
    recipient: string;
    amount: string;
    tokenId?: string | Uint8Array | null;
  }): Promise<void> {
    const recipient = this.requireAddress(params.recipient);
    const tokenId = this.normalizeTokenId(params.tokenId);
    await rpcCall(this._rpcUrl, 'proxy_faucetDrip', {
      recipient,
      amount: stripHexPrefix(params.amount),
      token_id: tokenId,
    });
  }

  async getAccountInfo(params: {
    address: string;
    tokenBalancesFilter?: Array<string | Uint8Array> | null;
    stateKeyFilter?: Array<string | Uint8Array> | null;
    certificateByNonce?: { start: number; limit: number } | null;
  }): Promise<FastAccountInfo> {
    return (await rpcCall(this._rpcUrl, 'proxy_getAccountInfo', {
      address: this.requireAddress(params.address),
      token_balances_filter: this.normalizeBytes32Array(params.tokenBalancesFilter, 'token_balances_filter'),
      state_key_filter: this.normalizeBytes32Array(params.stateKeyFilter, 'state_key_filter'),
      certificate_by_nonce: params.certificateByNonce ?? null,
    })) as FastAccountInfo;
  }

  async getPendingMultisigTransactions(address: string): Promise<FastTransactionEnvelope[]> {
    return (await rpcCall(this._rpcUrl, 'proxy_getPendingMultisigTransactions', {
      address: this.requireAddress(address),
    })) as FastTransactionEnvelope[];
  }

  async getTokenInfo(tokenIds: Array<string | Uint8Array>): Promise<{
    requested_token_metadata?: Array<[number[], {
      update_id?: number;
      admin?: number[];
      token_name?: string;
      decimals?: number;
      total_supply?: string;
      mints?: number[][];
    } | null]>;
  } | null> {
    return (await rpcCall(this._rpcUrl, 'proxy_getTokenInfo', {
      token_ids: tokenIds.map((tokenId) => this.normalizeTokenId(tokenId, 'token_id')),
    })) as {
      requested_token_metadata?: Array<[number[], {
        update_id?: number;
        admin?: number[];
        token_name?: string;
        decimals?: number;
        total_supply?: string;
        mints?: number[][];
      } | null]>;
    } | null;
  }

  async getTransactionCertificates(
    address: string,
    fromNonce: number,
    limit: number,
  ): Promise<FastTransactionCertificate[]> {
    if (!Number.isInteger(fromNonce) || fromNonce < 0) {
      throw new FastError('INVALID_PARAMS', `Invalid nonce: ${fromNonce}`, {
        note: 'Pass a non-negative integer nonce.',
      });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new FastError('INVALID_PARAMS', `Invalid certificate limit: ${limit}`, {
        note: 'Pass an integer limit between 1 and 200.',
      });
    }

    return (await rpcCall(this._rpcUrl, 'proxy_getTransactionCertificates', {
      address: this.requireAddress(address),
      from_nonce: fromNonce,
      limit,
    })) as FastTransactionCertificate[];
  }

  private requireAddress(address: string): Uint8Array {
    try {
      return Address.fromString(address).bytes;
    } catch {
      throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${address}"`, {
        note: 'Pass a valid fast... bech32m address.',
      });
    }
  }

  private normalizeBytes32Array(
    values: Array<string | Uint8Array> | null | undefined,
    fieldName: string,
  ): Uint8Array[] | null {
    if (values === undefined || values === null) {
      return null;
    }
    return values.map((value) => normalizeMaybeBytes32(value, fieldName));
  }

  private normalizeTokenId(
    tokenId: string | Uint8Array | null | undefined,
    fieldName: string = 'token_id',
  ): Uint8Array | null {
    if (tokenId === null || tokenId === undefined) {
      return null;
    }
    if (typeof tokenId === 'string') {
      return hexToTokenId(tokenId);
    }
    if (tokenId.length !== 32) {
      throw new FastError('INVALID_PARAMS', `${fieldName} must be exactly 32 bytes`, {
        note: `Pass a 32-byte token id for ${fieldName}.`,
      });
    }
    return tokenId;
  }
}
