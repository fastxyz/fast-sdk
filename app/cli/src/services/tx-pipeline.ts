import {
  bcsSchema,
  type NetworkId,
  type OperationInputParams,
  type TransactionEnvelope,
  TransactionEnvelopeFromRest,
  VersionedTransactionFromBcs,
} from '@fastxyz/schema';
import { hashHex, TransactionBuilder } from '@fastxyz/sdk';
import { Effect, Schema } from 'effect';
import { FastSdkError, TransactionFailedError, TransactionSubmissionUnknownError } from '../errors/index.js';
import { FastRpc } from './api/fast.js';
import type { ResolvedSigner } from './signer-resolver.js';

export interface TxPipelineSuccess {
  readonly status: 'success';
  readonly envelope: TransactionEnvelope;
  readonly txHash: string;
  readonly nonce: bigint;
}

export interface TxPipelineIncomplete {
  readonly status: 'incomplete-multisig';
  readonly envelope: TransactionEnvelope;
  readonly txHash: null;
  readonly nonce: bigint;
}

export type TxPipelineResult = TxPipelineSuccess | TxPipelineIncomplete;
export type TxPipelineError = TransactionFailedError | TransactionSubmissionUnknownError;

// These tags are produced after the proxy/validator has received and rejected
// the request. They are not an indeterminate network outcome. Transport
// failures, timeouts, and unknown SDK causes intentionally remain unknown.
const definitiveSubmissionErrorTags = new Set([
  'InvalidRequestError',
  'NotFoundError',
  'TooManyCertificatesRequestedError',
  'ProxyUnexpectedNonceError',
  'VerifierSigsInvalidError',
  'UnexpectedNonceError',
  'InsufficientFundingError',
  'PreviousTransactionPendingError',
  'InvalidSignatureError',
  'MissingEarlierConfirmationsError',
  'CertificateTooYoungError',
  'NonSubmittableOperationError',
  'ValidatorGenericError',
]);

export const isDefinitiveSubmissionFailure = (cause: unknown): boolean => {
  const underlying = cause instanceof FastSdkError ? cause.cause : cause;
  if (!underlying || typeof underlying !== 'object') return false;
  const tag = (underlying as { readonly _tag?: unknown })._tag;
  return typeof tag === 'string' && definitiveSubmissionErrorTags.has(tag);
};

export const classifySubmissionError = (params: {
  readonly txHash: string;
  readonly nonce: bigint;
  readonly envelope: TransactionEnvelope;
  readonly recoveryEnvelope: unknown;
  readonly cause: unknown;
}): TxPipelineError => {
  if (isDefinitiveSubmissionFailure(params.cause)) {
    const message =
      params.cause instanceof FastSdkError
        ? params.cause.message
        : params.cause instanceof Error
          ? params.cause.message
          : 'Transaction submission was rejected by the Fast network.';
    return new TransactionFailedError({ message, cause: params.cause });
  }
  return new TransactionSubmissionUnknownError(params);
};

export interface SubmitOperationParams {
  readonly resolved: ResolvedSigner;
  readonly networkId: NetworkId;
  readonly operation: OperationInputParams;
  /**
   * Allow replacing a multisig proposal observed by the best-effort preflight
   * at the account's current nonce. This is not an authoritative compare-and-
   * swap: concurrent clients can both observe no proposal before either
   * submits, and a delayed vote can restore a proposal that was replaced after
   * the voter fetched it. Operator serialization must cover initiation,
   * replacement, and voting because the proxy has no conditional-write
   * primitive.
   */
  readonly replacePending?: boolean;
}

export interface SubmissionRecovery {
  readonly txHash: string;
  readonly recoveryEnvelope: unknown;
}

const normalizeTxHash = (hash: string): string => {
  const lower = hash.toLowerCase();
  return lower.startsWith('0x') ? lower.slice(2) : lower;
};

/** Confirm that a Success certificate is for the exact submitted transaction and network. */
export const successCertificateMatches = async (
  submitResult: unknown,
  expectedTxHash: string,
  expectedNetwork: NetworkId,
): Promise<boolean> => {
  const result = submitResult as {
    readonly type?: unknown;
    readonly value?: { readonly envelope?: { readonly transaction?: unknown } };
  } | null;
  if (result?.type !== 'Success') return false;
  const transaction = result.value?.envelope?.transaction;
  if (!transaction || typeof transaction !== 'object') return false;
  const networkId = (transaction as { readonly value?: { readonly networkId?: unknown } }).value?.networkId;
  if (networkId !== expectedNetwork) return false;
  try {
    const certificateBytes = Schema.encodeSync(VersionedTransactionFromBcs)(transaction as never);
    const certificateHash = await hashHex(bcsSchema.VersionedTransaction, certificateBytes);
    return normalizeTxHash(certificateHash) === normalizeTxHash(expectedTxHash);
  } catch {
    return false;
  }
};

/**
 * Compute the immutable transaction identity and a JSON-safe representation of
 * the exact signed envelope before the mutable submit request begins.
 */
export const prepareSubmissionRecovery = (envelope: TransactionEnvelope): Effect.Effect<SubmissionRecovery, TransactionFailedError> =>
  Effect.gen(function* () {
    const bcsInput = yield* Schema.encode(VersionedTransactionFromBcs)(envelope.transaction).pipe(
      Effect.mapError(
        (cause) =>
          new TransactionFailedError({
            message: 'Failed to encode transaction for hashing',
            cause,
          }),
      ),
    );
    const txHash = yield* Effect.tryPromise({
      try: () => hashHex(bcsSchema.VersionedTransaction, bcsInput),
      catch: (cause) =>
        new TransactionFailedError({
          message: 'Failed to compute transaction hash',
          cause,
        }),
    });
    const encodedRecoveryEnvelope = yield* Schema.encode(TransactionEnvelopeFromRest)(envelope).pipe(
      Effect.mapError(
        (cause) =>
          new TransactionFailedError({
            message: 'Failed to encode the signed recovery envelope',
            cause,
          }),
      ),
    );
    const recoveryEnvelope = yield* Effect.try({
      try: () =>
        JSON.parse(JSON.stringify(encodedRecoveryEnvelope, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))) as unknown,
      catch: (cause) =>
        new TransactionFailedError({
          message: 'Failed to serialize the signed recovery envelope',
          cause,
        }),
    });
    return { txHash, recoveryEnvelope };
  });

const opAsBuilderCall = (builder: TransactionBuilder, op: OperationInputParams): TransactionBuilder => {
  switch (op.type) {
    case 'TokenTransfer':
      return builder.addTokenTransfer(op.value);
    case 'TokenCreation':
      return builder.addTokenCreation(op.value);
    case 'TokenManagement':
      return builder.addTokenManagement(op.value);
    case 'Mint':
      return builder.addMint(op.value);
    case 'Burn':
      return builder.addBurn(op.value);
    case 'StateInitialization':
      return builder.addStateInitialization(op.value);
    case 'StateUpdate':
      return builder.addStateUpdate(op.value);
    case 'StateReset':
      return builder.addStateReset(op.value);
    case 'ExternalClaim':
      return builder.addExternalClaim(op.value);
    case 'LeaveCommittee':
      return builder.addLeaveCommittee();
    case 'Escrow':
      return builder.addEscrow(op.value);
    default:
      // JoinCommittee / ChangeCommittee are valid OperationInputParams variants
      // but TransactionBuilder doesn't expose builder methods for them yet.
      // The multisig path bypasses this switch and hands operations to
      // signTransaction directly, so it isn't affected.
      throw new Error(`single-signer dispatch doesn't support op type: ${(op as { type: string }).type}`);
  }
};

export const submitOperation = (params: SubmitOperationParams): Effect.Effect<TxPipelineResult, TxPipelineError, FastRpc> =>
  Effect.gen(function* () {
    const rpc = yield* FastRpc;

    // 1. Resolve sender bytes
    const senderBytes = yield* Effect.tryPromise({
      try: () => (params.resolved.kind === 'single' ? params.resolved.signer.getPublicKey() : params.resolved.signer.getDerivedAddressBytes()),
      catch: (cause) =>
        new TransactionFailedError({
          message: 'Failed to resolve sender bytes',
          cause,
        }),
    });

    // 2. Fetch nonce
    const accountInfoRpc = yield* rpc
      .getAccountInfo({
        address: senderBytes,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      } as never)
      .pipe(
        Effect.mapError(
          (cause) =>
            new TransactionFailedError({
              message: 'Failed to fetch account info',
              cause,
            }),
        ),
      );
    const accountInfo = accountInfoRpc as {
      readonly nextNonce?: bigint;
      readonly pendingConfirmation?: unknown;
    } | null;
    if (accountInfo?.pendingConfirmation != null) {
      return yield* Effect.fail(
        new TransactionFailedError({
          message: 'Account has a transaction pending validator confirmation; refusing to sign another transaction at this nonce.',
        }),
      );
    }
    const nonce = accountInfo?.nextNonce ?? 0n;

    // Best-effort preflight: the proxy keeps proposals outside
    // accountInfo.pendingConfirmation. This blocks replacement when a proposal
    // is already observable, but it cannot close the GET -> submit race without
    // an authoritative conditional-submit primitive in the proxy.
    if (params.resolved.kind === 'multisig') {
      const rawPending = yield* rpc.getPendingMultisigTransactions({ address: senderBytes } as never).pipe(
        Effect.mapError(
          (cause) =>
            new TransactionFailedError({
              message: 'Failed to fetch pending multisig transactions',
              cause,
            }),
        ),
      );
      const pendingAtCurrentNonce = (rawPending as ReadonlyArray<TransactionEnvelope>).filter(
        (candidate) => candidate.transaction.value.nonce === nonce,
      );
      if (pendingAtCurrentNonce.length > 0 && !params.replacePending) {
        return yield* Effect.fail(
          new TransactionFailedError({
            message:
              `Account already has ${pendingAtCurrentNonce.length} multisig proposal(s) at nonce ${nonce}. ` +
              'Refusing to replace them; inspect with `fast multisig pending` and pass `--replace-pending` only if replacement is intentional.',
          }),
        );
      }
    }

    // 3. Build + sign envelope
    let envelope: TransactionEnvelope;
    if (params.resolved.kind === 'single') {
      const singleSigner = params.resolved.signer;
      const builder = new TransactionBuilder({
        networkId: params.networkId,
        signer: singleSigner,
        nonce,
      });
      envelope = yield* Effect.tryPromise({
        try: () => opAsBuilderCall(builder, params.operation).sign(),
        catch: (cause) =>
          new TransactionFailedError({
            message: 'Failed to sign transaction',
            cause,
          }),
      });
    } else {
      const multisigSigner = params.resolved.signer;
      envelope = yield* Effect.tryPromise({
        try: () =>
          multisigSigner.signTransaction({
            networkId: params.networkId,
            nonce,
            operations: [params.operation],
          }),
        catch: (cause) =>
          new TransactionFailedError({
            message: 'Failed to sign multisig transaction',
            cause,
          }),
      });
    }

    // 4. Freeze recovery identity before the mutable submit request. A lost
    // response is indeterminate: the proxy may have accepted the envelope.
    const recovery = yield* prepareSubmissionRecovery(envelope);

    // 5. Submit
    const submitResult = yield* rpc.submitTransaction(envelope).pipe(
      Effect.mapError((cause) =>
        classifySubmissionError({
          txHash: recovery.txHash,
          nonce,
          envelope,
          recoveryEnvelope: recovery.recoveryEnvelope,
          cause,
        }),
      ),
    );

    // 6. Branch on result type
    const submitObj = (submitResult as { type?: string } | null) ?? null;
    if (submitObj?.type === 'IncompleteMultiSig') {
      if (params.resolved.kind !== 'multisig') {
        return yield* Effect.fail(
          new TransactionFailedError({
            message: 'Unexpected IncompleteMultiSig response for single-signer transaction.',
          }),
        );
      }
      return {
        status: 'incomplete-multisig',
        envelope,
        txHash: null,
        nonce,
      } satisfies TxPipelineIncomplete;
    }
    if (submitObj?.type === 'IncompleteVerifierSigs') {
      return yield* Effect.fail(
        new TransactionFailedError({
          message: 'Transaction is pending verifier signatures and cannot be treated as finalized.',
        }),
      );
    }
    if (submitObj?.type !== 'Success') {
      return yield* Effect.fail(
        new TransactionFailedError({
          message: `Unexpected submit result: ${submitObj?.type ?? 'missing type'}`,
        }),
      );
    }

    const certificateMatches = yield* Effect.promise(() => successCertificateMatches(submitResult, recovery.txHash, params.networkId));
    if (!certificateMatches) {
      return yield* Effect.fail(
        new TransactionSubmissionUnknownError({
          txHash: recovery.txHash,
          nonce,
          envelope,
          recoveryEnvelope: recovery.recoveryEnvelope,
          cause: new TransactionFailedError({
            message: 'Success certificate does not match the submitted transaction or network.',
          }),
        }),
      );
    }

    return {
      status: 'success',
      envelope,
      txHash: recovery.txHash,
      nonce,
    } satisfies TxPipelineSuccess;
  });
