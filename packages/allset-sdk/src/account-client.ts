import { FastProvider, toHex } from '@fastxyz/sdk';
import {
  bcsSchema,
  ProxySubmitTransactionResultFromRpc,
  TransactionInput,
  VersionedTransactionFromBcs,
  VersionedTransactionFromRpc,
} from '@fastxyz/schema';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Schema } from 'effect';
import { FastError } from './errors.js';
import { fastAddressToBytes } from './address.js';
import {
  createTransactionSigningMessage,
  type FastSigner,
} from './signer.js';
import type {
  FastAccountIdentity,
  FastEnvelopeSignature,
  FastPrepareTransactionOptions,
  FastPreparedTransaction,
  FastPreparedTransactionAuthorization,
  FastSignerDescriptor,
  FastTransaction,
  FastTransactionAuthorization,
  FastTransactionCertificate,
  FastVersionedTransaction,
  SendResult,
  SignResult,
  SubmitResult,
} from './types.js';

const DEFAULT_NETWORK_ID = 'fast:testnet';

type RpcSubmitResult =
  | { Success: FastTransactionCertificate }
  | { IncompleteVerifierSigs: unknown[] }
  | { IncompleteMultiSig: unknown[] };

function decodeFastAddressOrThrow(address: string): Uint8Array {
  try {
    return fastAddressToBytes(address);
  } catch {
    throw new FastError('INVALID_ADDRESS', `Invalid Fast address: "${address}"`, {
      note: 'Pass a valid fast1... bech32m address.',
    });
  }
}

function normalizeTransaction(
  transaction: FastVersionedTransaction,
): FastTransaction {
  if (transaction && typeof transaction === 'object' && 'type' in transaction && transaction.type === 'Release20260319') {
    return transaction.value as FastTransaction;
  }
  if (transaction && typeof transaction === 'object' && 'Release20260319' in transaction) {
    return transaction.Release20260319 as FastTransaction;
  }
  return transaction as unknown as FastTransaction;
}

function hashTransaction(transaction: FastVersionedTransaction): string {
  const serialized = bcsSerializeVersionedTransaction(transaction);
  return toHex(keccak_256(serialized));
}

function bcsSerializeVersionedTransaction(transaction: FastVersionedTransaction): Uint8Array {
  const wire = Schema.encodeSync(VersionedTransactionFromBcs)(transaction as any);
  return bcsSchema.VersionedTransaction.serialize(wire as any).toBytes();
}

function rpcErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (current instanceof Uint8Array) {
      return Array.from(current);
    }
    if (typeof current === 'bigint') {
      return current.toString();
    }
    return current;
  });
}

function mapSubmissionError(
  err: unknown,
  opts: { insufficientNote: string; txFailedNote: string; txFailedFallbackMessage: string },
): FastError {
  if (err instanceof FastError) return err;
  const message = rpcErrorMessage(err);
  const lower = message.toLowerCase();

  if (lower.includes('insufficient')) {
    return new FastError('INSUFFICIENT_BALANCE', message, { note: opts.insufficientNote });
  }
  if (lower.includes('nonce')) {
    return new FastError('TX_FAILED', `Nonce conflict: ${message}`, { note: opts.txFailedNote });
  }
  return new FastError('TX_FAILED', message || opts.txFailedFallbackMessage, {
    note: opts.txFailedNote,
  });
}

function envelopeToRpc(signature: FastTransactionAuthorization['signature']): FastEnvelopeSignature {
  return signature;
}

export interface FastAccountClientOptions {
  provider: FastProvider;
  signer: FastSigner;
  address: string;
  networkId?: string;
  signerDescriptor?: FastSignerDescriptor;
}

export class FastAccountClient {
  protected readonly _provider: FastProvider;
  protected readonly _signer: FastSigner;
  protected readonly _address: string;
  private readonly _networkId: string;
  private readonly _signerDescriptor: Promise<FastSignerDescriptor>;

  constructor(options: FastAccountClientOptions) {
    this._provider = options.provider;
    this._signer = options.signer;
    this._address = options.address;
    this._networkId = options.networkId ?? DEFAULT_NETWORK_ID;
    this._signerDescriptor = Promise.resolve(options.signerDescriptor ?? options.signer.describe());
  }

  static async connect(options: {
    provider: FastProvider;
    signer: FastSigner;
    address?: string;
    networkId?: string;
  }): Promise<FastAccountClient> {
    const signerDescriptor = await options.signer.describe();
    const address = options.address ?? signerDescriptor.address;

    if (address !== signerDescriptor.address) {
      throw new FastError(
        'INVALID_PARAMS',
        `Signer address "${signerDescriptor.address}" does not match requested address "${address}".`,
        {
          note: 'Pass the signer-owned account address or omit address to use the signer descriptor.',
        },
      );
    }

    return new FastAccountClient({
      provider: options.provider,
      signer: options.signer,
      address,
      networkId: options.networkId,
      signerDescriptor,
    });
  }

  get address(): string {
    return this._address;
  }

  get provider(): FastProvider {
    return this._provider;
  }

  async describeSigner(): Promise<FastSignerDescriptor> {
    return this._signerDescriptor;
  }

  async getAccountIdentity(): Promise<FastAccountIdentity> {
    const descriptor = await this.describeSigner();
    return {
      address: this._address,
      publicKey: descriptor.publicKey ? toHex(descriptor.publicKey) : null,
      signer: descriptor.capabilities,
      metadata: descriptor.metadata,
    };
  }

  async sign(params: { message: string | Uint8Array }): Promise<SignResult> {
    const descriptor = await this.describeSigner();
    if (!descriptor.capabilities.canSignMessages || !this._signer.signMessage) {
      throw new FastError(
        'UNSUPPORTED_OPERATION',
        'This signer does not support arbitrary message signing.',
        {
          note: 'Use a signer that implements signMessage or limit this account to transaction authorization only.',
        },
      );
    }

    const messageBytes = typeof params.message === 'string'
      ? new TextEncoder().encode(params.message)
      : params.message;
    const signature = await this._signer.signMessage(messageBytes);

    return {
      signature: toHex(signature),
      address: this._address,
      messageBytes: toHex(messageBytes),
    };
  }

  async prepareTransaction(params: FastPrepareTransactionOptions): Promise<FastPreparedTransaction> {
    const senderPubkey = decodeFastAddressOrThrow(this._address);
    let nonce = params.nonce;
    if (nonce === undefined) {
      const accountInfo = await this._provider.getAccountInfo({ address: this._address });
      nonce = (accountInfo as { next_nonce?: number } | null)?.next_nonce ?? 0;
    }

    const rawTransaction = {
      networkId: this._networkId,
      sender: senderPubkey,
      nonce,
      timestampNanos: params.timestampNanos ?? BigInt(Date.now()) * 1_000_000n,
      claim: params.claim,
      archival: params.archival ?? false,
      feeToken: params.feeToken ? Array.from(params.feeToken) : null,
    };

    const transaction = Schema.decodeUnknownSync(TransactionInput)(rawTransaction) as FastTransaction;
    const versionedTransaction = { type: 'Release20260319' as const, value: transaction } as FastVersionedTransaction;

    return {
      address: this._address,
      transaction: versionedTransaction,
      txHash: hashTransaction(versionedTransaction),
      signingMessage: createTransactionSigningMessage(versionedTransaction),
    };
  }

  async authorizePreparedTransaction(
    preparedTransaction: FastPreparedTransaction,
  ): Promise<FastPreparedTransactionAuthorization> {
    if (preparedTransaction.address !== this._address) {
      throw new FastError(
        'INVALID_PARAMS',
        `Prepared transaction belongs to "${preparedTransaction.address}", not "${this._address}".`,
        {
          note: 'Authorize and submit the prepared transaction with the matching account client.',
        },
      );
    }

    const authorization = await this._signer.authorizeTransaction(preparedTransaction.transaction);
    this.assertAuthorizationAddress(authorization);

    return {
      preparedTransaction,
      authorization,
    };
  }

  async authorizeClaim(
    params: FastPrepareTransactionOptions,
  ): Promise<FastPreparedTransactionAuthorization> {
    const preparedTransaction = await this.prepareTransaction(params);
    return this.authorizePreparedTransaction(preparedTransaction);
  }

  async submitPreparedTransaction(
    preparedTransaction: FastPreparedTransaction,
    authorization?: FastTransactionAuthorization,
  ): Promise<SubmitResult> {
    if (preparedTransaction.address !== this._address) {
      throw new FastError(
        'INVALID_PARAMS',
        `Prepared transaction belongs to "${preparedTransaction.address}", not "${this._address}".`,
        {
          note: 'Submit the prepared transaction with the matching account client.',
        },
      );
    }

    const resolvedAuthorization = authorization
      ?? (await this.authorizePreparedTransaction(preparedTransaction)).authorization;
    this.assertAuthorizationAddress(resolvedAuthorization);

    try {
      const rpcTransaction = Schema.encodeSync(VersionedTransactionFromRpc)(
        preparedTransaction.transaction,
      );
      const response = await fetch(this._provider.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stringifyJson({
          jsonrpc: '2.0',
          id: 1,
          method: 'proxy_submitTransaction',
          params: {
            transaction: rpcTransaction,
            signature: envelopeToRpc(resolvedAuthorization.signature),
          },
        }),
      });

      const body = (await response.json()) as {
        result?: unknown;
        error?: { message?: string };
      };

      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }

      const submitResult = Schema.decodeUnknownSync(
        ProxySubmitTransactionResultFromRpc,
      )(body.result);

      if (submitResult.type === 'IncompleteVerifierSigs') {
        throw new FastError('TX_FAILED', 'Transaction submission is incomplete: missing verifier signatures', {
          note: 'Provide all required verifier signatures before submitting this transaction.',
        });
      }
      if (submitResult.type === 'IncompleteMultiSig') {
        throw new FastError('TX_FAILED', 'Transaction submission is incomplete: missing multisig signatures', {
          note: 'Provide the required multisig signatures before submitting this transaction.',
        });
      }

      return {
        txHash: preparedTransaction.txHash,
        certificate: submitResult.value,
      };
    } catch (err: unknown) {
      throw mapSubmissionError(err, {
        insufficientNote: 'Fund your Fast wallet with FAST or the token you are sending, then retry.',
        txFailedNote: 'Wait 5 seconds, then retry.',
        txFailedFallbackMessage: 'Transaction submission failed.',
      });
    }
  }

  async submit(params: FastPrepareTransactionOptions): Promise<SubmitResult> {
    const preparedTransaction = await this.prepareTransaction(params);
    return this.submitPreparedTransaction(preparedTransaction);
  }

  private assertAuthorizationAddress(authorization: FastTransactionAuthorization): void {
    if (authorization.address !== this._address) {
      throw new FastError(
        'INVALID_PARAMS',
        `Authorization belongs to "${authorization.address}", not "${this._address}".`,
        {
          note: 'Use an authorization returned by the signer for this account.',
        },
      );
    }
  }
}
