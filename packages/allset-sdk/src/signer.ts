import { bcsSchema, VersionedTransactionFromBcs } from '@fastxyz/schema';
import { Schema } from 'effect';
import type {
  FastDelegatedAccessKeyAuthorization,
  FastEnvelopeSignature,
  FastPasskeyOwnerAuthorization,
  FastSignerCapabilities,
  FastSignerDescriptor,
  FastTransaction,
  FastTransactionAuthorization,
  FastVersionedTransaction,
} from './types.js';

const VERSIONED_TRANSACTION_PREFIX = new TextEncoder().encode('VersionedTransaction::');

export interface FastSigner {
  describe(): Promise<FastSignerDescriptor>;
  signMessage?(messageBytes: Uint8Array): Promise<Uint8Array>;
  authorizeTransaction(transaction: FastVersionedTransaction): Promise<FastTransactionAuthorization>;
}

export interface FastCustomSignerOptions {
  describe: FastSignerDescriptor | (() => Promise<FastSignerDescriptor> | FastSignerDescriptor);
  signMessage?: (messageBytes: Uint8Array) => Promise<Uint8Array>;
  authorizeTransaction: (
    transaction: FastVersionedTransaction,
  ) => Promise<FastTransactionAuthorization>;
}

export interface FastPasskeyOwnerSignerOptions {
  address: string;
  publicKey?: Uint8Array | null;
  metadata?: Record<string, unknown>;
  signMessage?: (messageBytes: Uint8Array) => Promise<Uint8Array>;
  authorizeTransaction: (
    transaction: FastVersionedTransaction,
  ) => Promise<FastPasskeyOwnerAuthorization | FastTransactionAuthorization>;
}

export interface FastDelegatedAccessKeySignerOptions {
  address: string;
  publicKey?: Uint8Array | null;
  policy: FastDelegatedAccessKeyAuthorization['policy'];
  metadata?: Record<string, unknown>;
  signMessage?: (messageBytes: Uint8Array) => Promise<Uint8Array>;
  authorizeTransaction: (
    transaction: FastVersionedTransaction,
  ) => Promise<FastDelegatedAccessKeyAuthorization | FastTransactionAuthorization>;
}

export interface FastRemoteSignerOptions {
  address: string;
  publicKey?: Uint8Array | null;
  role: FastSignerCapabilities['role'];
  metadata?: Record<string, unknown>;
  signMessage?: (messageBytes: Uint8Array) => Promise<Uint8Array>;
  authorizeTransaction: (
    transaction: FastVersionedTransaction,
  ) => Promise<FastTransactionAuthorization>;
}

class CallbackFastSigner implements FastSigner {
  private readonly describeFn: () => Promise<FastSignerDescriptor>;
  private readonly signMessageFn?: (messageBytes: Uint8Array) => Promise<Uint8Array>;
  private readonly authorizeTransactionFn: (
    transaction: FastVersionedTransaction,
  ) => Promise<FastTransactionAuthorization>;

  constructor(options: FastCustomSignerOptions) {
    const describe = options.describe;
    this.describeFn = typeof describe === 'function'
      ? async () => describe()
      : async () => describe;
    this.signMessageFn = options.signMessage;
    this.authorizeTransactionFn = options.authorizeTransaction;
  }

  async describe(): Promise<FastSignerDescriptor> {
    return this.describeFn();
  }

  async signMessage(messageBytes: Uint8Array): Promise<Uint8Array> {
    if (!this.signMessageFn) {
      throw new Error('signMessage is not implemented for this signer');
    }
    return this.signMessageFn(messageBytes);
  }

  async authorizeTransaction(
    transaction: FastVersionedTransaction,
  ): Promise<FastTransactionAuthorization> {
    return this.authorizeTransactionFn(transaction);
  }
}

function withCapabilities(
  capabilities: FastSignerCapabilities,
  metadata?: Record<string, unknown>,
): Pick<FastSignerDescriptor, 'capabilities' | 'metadata'> {
  return { capabilities, metadata };
}

function withAuthorizationEnvelope(
  address: string,
  capabilities: FastSignerCapabilities,
  signature: FastEnvelopeSignature,
  metadata?: Record<string, unknown>,
): FastTransactionAuthorization {
  return { address, capabilities, signature, metadata };
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function normalizeTransaction(transaction: FastVersionedTransaction): FastTransaction {
  if (transaction && typeof transaction === 'object' && 'type' in transaction && transaction.type === 'Release20260319') {
    return transaction.value as FastTransaction;
  }
  if (transaction && typeof transaction === 'object' && 'Release20260319' in transaction) {
    return transaction.Release20260319 as FastTransaction;
  }
  return transaction as unknown as FastTransaction;
}

export function createTransactionSigningMessage(
  transaction: FastVersionedTransaction,
): Uint8Array {
  const wire = Schema.encodeSync(VersionedTransactionFromBcs)(transaction as any);
  return concatBytes(
    VERSIONED_TRANSACTION_PREFIX,
    bcsSchema.VersionedTransaction.serialize(wire as any).toBytes(),
  );
}

export function createSignatureEnvelope(signature: Uint8Array | number[]): FastEnvelopeSignature {
  return { Signature: Array.from(signature) };
}

export function createPasskeyOwnerEnvelope(
  authorization: FastPasskeyOwnerAuthorization,
): FastEnvelopeSignature {
  return { PasskeyOwner: authorization };
}

export function createDelegatedAccessKeyEnvelope(
  authorization: FastDelegatedAccessKeyAuthorization,
): FastEnvelopeSignature {
  return { DelegatedAccessKey: authorization };
}

export function createCustomSigner(options: FastCustomSignerOptions): FastSigner {
  return new CallbackFastSigner(options);
}

export function createPasskeyOwnerSigner(
  options: FastPasskeyOwnerSignerOptions,
): FastSigner {
  const descriptor: FastSignerDescriptor = {
    address: options.address,
    publicKey: options.publicKey ?? null,
    ...withCapabilities(
      {
        kind: 'passkey-owner',
        role: 'owner',
        origin: 'non-extractable',
        canSignMessages: Boolean(options.signMessage),
        canAuthorizeTransactions: true,
      },
      options.metadata,
    ),
  };

  return createCustomSigner({
    describe: descriptor,
    signMessage: options.signMessage,
    authorizeTransaction: async (transaction) => {
      const result = await options.authorizeTransaction(transaction);
      if ('signature' in result && 'capabilities' in result) {
        return result;
      }
      return withAuthorizationEnvelope(
        options.address,
        descriptor.capabilities,
        createPasskeyOwnerEnvelope(result),
        options.metadata,
      );
    },
  });
}

export function createDelegatedAccessKeySigner(
  options: FastDelegatedAccessKeySignerOptions,
): FastSigner {
  const descriptor: FastSignerDescriptor = {
    address: options.address,
    publicKey: options.publicKey ?? null,
    ...withCapabilities(
      {
        kind: 'delegated-access-key',
        role: 'delegated',
        origin: 'hybrid',
        canSignMessages: Boolean(options.signMessage),
        canAuthorizeTransactions: true,
      },
      {
        ...options.metadata,
        policy: options.policy,
      },
    ),
  };

  return createCustomSigner({
    describe: descriptor,
    signMessage: options.signMessage,
    authorizeTransaction: async (transaction) => {
      const result = await options.authorizeTransaction(transaction);
      if ('signature' in result && 'capabilities' in result) {
        return result;
      }
      return withAuthorizationEnvelope(
        options.address,
        descriptor.capabilities,
        createDelegatedAccessKeyEnvelope(result),
        {
          ...options.metadata,
          policy: options.policy,
        },
      );
    },
  });
}

export function createRemoteSigner(options: FastRemoteSignerOptions): FastSigner {
  return createCustomSigner({
    describe: {
      address: options.address,
      publicKey: options.publicKey ?? null,
      ...withCapabilities(
        {
          kind: 'remote',
          role: options.role,
          origin: 'remote',
          canSignMessages: Boolean(options.signMessage),
          canAuthorizeTransactions: true,
        },
        options.metadata,
      ),
    },
    signMessage: options.signMessage,
    authorizeTransaction: options.authorizeTransaction,
  });
}
