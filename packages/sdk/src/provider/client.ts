import { stripHexPrefix } from '../bytes';
import { FastError } from '../errors';
import { rpcCall } from '../rpc';
import type { BytesLike } from '../types';
import {
  isObject,
  normalizeAddress,
  normalizeBytes32,
  normalizeBytes32Array,
  normalizeSignatureOrMultiSig,
} from './normalize';
import type {
  FastAccountInfo,
  FastSubmitTransactionResult,
  FastTokenInfoResponse,
  FastTransactionCertificate,
  FastTransactionEnvelope,
  FastTransactionEnvelopeInput,
  FaucetDripParams,
  GetAccountInfoParams,
  ProviderOptions,
} from './types';

function isTransactionCertificate(value: unknown): value is FastTransactionCertificate {
  return Boolean(
    value
      && isObject(value)
      && 'envelope' in value
      && 'signatures' in value,
  );
}

/**
 * FastProvider — isomorphic 1:1 RPC provider for documented Fast proxy endpoints.
 */
export class FastProvider {
  private readonly _rpcUrl: string;

  constructor(opts: ProviderOptions) {
    if (!opts?.rpcUrl || typeof opts.rpcUrl !== 'string') {
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
    envelope: FastTransactionEnvelopeInput,
  ): Promise<FastSubmitTransactionResult> {
    const result = await rpcCall(this._rpcUrl, 'proxy_submitTransaction', {
      transaction: envelope.transaction,
      signature: normalizeSignatureOrMultiSig(envelope.signature),
    });

    if (isTransactionCertificate(result)) {
      return { Success: result };
    }

    if (isObject(result) && (
      'Success' in result
      || 'IncompleteVerifierSigs' in result
      || 'IncompleteMultiSig' in result
    )) {
      return result as FastSubmitTransactionResult;
    }

    throw new FastError('TX_FAILED', 'Unexpected proxy_submitTransaction result', {
      note: 'The proxy returned a result that does not match documented submitTransaction variants.',
    });
  }

  async faucetDrip(params: FaucetDripParams): Promise<void> {
    await rpcCall(this._rpcUrl, 'proxy_faucetDrip', {
      recipient: normalizeAddress(params.recipient, 'recipient'),
      amount: stripHexPrefix(params.amount),
      token_id: params.tokenId == null ? null : normalizeBytes32(params.tokenId, 'token_id'),
    });
  }

  async getAccountInfo(params: GetAccountInfoParams): Promise<FastAccountInfo> {
    return (await rpcCall(this._rpcUrl, 'proxy_getAccountInfo', {
      address: normalizeAddress(params.address, 'address'),
      token_balances_filter: normalizeBytes32Array(params.tokenBalancesFilter, 'token_balances_filter'),
      state_key_filter: normalizeBytes32Array(params.stateKeyFilter, 'state_key_filter'),
      certificate_by_nonce: params.certificateByNonce ?? null,
    })) as FastAccountInfo;
  }

  async getPendingMultisigTransactions(address: string | BytesLike): Promise<FastTransactionEnvelope[]> {
    return (await rpcCall(this._rpcUrl, 'proxy_getPendingMultisigTransactions', {
      address: normalizeAddress(address, 'address'),
    })) as FastTransactionEnvelope[];
  }

  async getTokenInfo(tokenIds: Array<string | BytesLike>): Promise<FastTokenInfoResponse | null> {
    return (await rpcCall(this._rpcUrl, 'proxy_getTokenInfo', {
      token_ids: tokenIds.map((tokenId) => normalizeBytes32(tokenId, 'token_id')),
    })) as FastTokenInfoResponse | null;
  }

  async getTransactionCertificates(
    address: string | BytesLike,
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
      address: normalizeAddress(address, 'address'),
      from_nonce: fromNonce,
      limit,
    })) as FastTransactionCertificate[];
  }
}
