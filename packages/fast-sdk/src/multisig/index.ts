import {
  bcsSchema,
  type NetworkId,
  type OperationInputParams,
  type SubmitTransactionResult,
  type TokenIdInput,
  type TransactionEnvelope,
  type TransactionVersion,
  type VersionedTransaction,
  VersionedTransactionFromBcs,
} from '@fastxyz/schema';
import { Schema } from 'effect';
import { hashHex } from '../interface/encode.js';
import { deriveMultiSigAddressBytes, type MultiSigConfig, MultiSigSigner, validateMultiSigConfig } from '../interface/multisig-signer.js';
import type { FastProvider } from '../interface/provider.js';
import { run } from '../core/run.js';

export { MultiSigConfigInvalidError, MultiSigSigner, NotAuthorizedSignerError, validateMultiSigConfig } from '../interface/multisig-signer.js';
export type { MultiSigConfig } from '../interface/multisig-signer.js';

export type MultiSigWorkflowErrorCode =
  | 'PENDING_CONFIRMATION'
  | 'PENDING_REPLACEMENT'
  | 'STALE_NONCE'
  | 'NO_PENDING_TRANSACTION'
  | 'AMBIGUOUS_PENDING_TRANSACTION'
  | 'TRANSACTION_NOT_FOUND'
  | 'SENDER_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'CONFIG_MISMATCH'
  | 'PREPARED_PAYLOAD_MISMATCH'
  | 'UNEXPECTED_SUBMIT_RESULT';

/** A fail-closed error raised before a headless multisig workflow signs. */
export class MultiSigWorkflowError extends Error {
  readonly code: MultiSigWorkflowErrorCode;

  constructor(code: MultiSigWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'MultiSigWorkflowError';
    this.code = code;
  }
}

/**
 * The provider call started but did not produce a conclusive response.
 * Callers must retain this identity and reconcile before attempting another
 * transaction at the same account nonce.
 */
export class MultiSigSubmissionUnknownError extends Error {
  readonly txHash: string;
  readonly nonce: bigint;
  readonly envelope: TransactionEnvelope;
  readonly cause: unknown;

  constructor(params: { txHash: string; nonce: bigint; envelope: TransactionEnvelope; cause: unknown }) {
    super(
      `Submission outcome is unknown for transaction ${params.txHash} at nonce ${params.nonce}. ` +
        'Retain this envelope and reconcile the account before retrying.',
    );
    this.name = 'MultiSigSubmissionUnknownError';
    this.txHash = params.txHash;
    this.nonce = params.nonce;
    this.envelope = params.envelope;
    this.cause = params.cause;
  }
}

export interface MultiSigPendingTransaction {
  readonly envelope: TransactionEnvelope;
  readonly txHash: string;
  readonly nonce: bigint;
  readonly signedCount: number;
  readonly quorum: number;
}

export interface MultiSigState {
  readonly address: Uint8Array;
  readonly nextNonce: bigint;
  readonly pendingConfirmation: unknown | null;
  readonly pending: readonly MultiSigPendingTransaction[];
}

export interface PrepareMultiSigTransactionParams {
  readonly signer: MultiSigSigner;
  readonly operations: readonly OperationInputParams[];
  readonly version?: TransactionVersion;
  readonly archival?: boolean;
  readonly feeToken?: TokenIdInput | null;
  readonly replacePending?: boolean;
}

export interface PreparedMultiSigTransaction {
  /** The complete unsigned payload. Present or render this before signing. */
  readonly transaction: VersionedTransaction;
  readonly txHash: string;
  readonly nonce: bigint;
  readonly replacedProposalHashes: readonly string[];
}

export interface SubmitPreparedMultiSigTransactionParams {
  readonly signer: MultiSigSigner;
  readonly prepared: PreparedMultiSigTransaction;
  readonly replacePending?: boolean;
}

export type MultiSigSubmission =
  | {
      readonly status: 'pending-signatures';
      readonly envelope: TransactionEnvelope;
      readonly txHash: string;
      readonly nonce: bigint;
      readonly submitResult: SubmitTransactionResult;
    }
  | {
      readonly status: 'submitted';
      readonly envelope: TransactionEnvelope;
      readonly txHash: string;
      readonly nonce: bigint;
      readonly submitResult: SubmitTransactionResult;
    }
  | {
      readonly status: 'pending-verifier-signatures';
      readonly envelope: TransactionEnvelope;
      readonly txHash: string;
      readonly nonce: bigint;
      readonly submitResult: SubmitTransactionResult;
    };

export interface VoteMultiSigTransactionParams {
  readonly signer: MultiSigSigner;
  /** The exact current-nonce proposal to approve. */
  readonly txHash: string;
}

type WorkflowProvider = Pick<FastProvider, 'getAccountInfo' | 'getPendingMultisigTransactions' | 'submitTransaction'>;

export interface MultiSigWorkflowOptions {
  readonly provider: WorkflowProvider;
  readonly networkId: NetworkId;
  readonly config: MultiSigConfig;
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);
const normalizeTxHash = (hash: string): string => hash.toLowerCase().replace(/^0x/, '');

const configsEqual = (a: MultiSigConfig, b: MultiSigConfig): boolean =>
  a.quorum === b.quorum &&
  a.nonce === b.nonce &&
  a.authorized_signers.length === b.authorized_signers.length &&
  a.authorized_signers.every((signer, index) => bytesEqual(signer, b.authorized_signers[index]!));

const envelopeConfigMatches = (envelope: TransactionEnvelope, config: MultiSigConfig): boolean => {
  if (envelope.signature.type !== 'MultiSig') return false;
  const actual = envelope.signature.value.config;
  return (
    actual.quorum === config.quorum &&
    actual.nonce === config.nonce &&
    actual.authorizedSigners.length === config.authorized_signers.length &&
    actual.authorizedSigners.every((signer, index) => bytesEqual(signer, config.authorized_signers[index]!))
  );
};

/** Compute the canonical transaction hash used by the proxy and Rust CLI. */
export async function getMultiSigTransactionHash(transaction: VersionedTransaction): Promise<string> {
  const bcsInput = await run(Schema.encode(VersionedTransactionFromBcs)(transaction));
  return hashHex(bcsSchema.VersionedTransaction, bcsInput);
}

/**
 * Browser/Node-neutral orchestration for the public multisig protocol.
 *
 * The workflow owns no key storage and never prompts. Applications supply a
 * public provider and an explicit `MultiSigSigner`, can call `prepare()` to
 * inspect the exact unsigned payload, then call `submitPrepared()` to sign and
 * submit those same bytes.
 */
export class MultiSigWorkflow {
  private readonly provider: WorkflowProvider;
  private readonly networkId: NetworkId;
  private readonly config: MultiSigConfig;

  constructor(options: MultiSigWorkflowOptions) {
    validateMultiSigConfig(options.config);
    this.provider = options.provider;
    this.networkId = options.networkId;
    this.config = {
      authorized_signers: options.config.authorized_signers.map((signer) => new Uint8Array(signer)),
      quorum: options.config.quorum,
      nonce: options.config.nonce,
    };
  }

  private assertSigner(signer: MultiSigSigner): void {
    if (!configsEqual(signer.config, this.config)) {
      throw new MultiSigWorkflowError('CONFIG_MISMATCH', 'Signer config does not match this multisig workflow.');
    }
  }

  private async fetchState(): Promise<MultiSigState> {
    const address = await deriveMultiSigAddressBytes(this.config);
    const [account, rawPending] = await Promise.all([
      this.provider.getAccountInfo({
        address,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
      }),
      this.provider.getPendingMultisigTransactions({ address }),
    ]);
    const nextNonce = account.nextNonce;
    const pending = await Promise.all(
      rawPending
        .filter((envelope) => envelope.transaction.value.nonce === nextNonce)
        .map(
          async (envelope): Promise<MultiSigPendingTransaction> => ({
            envelope,
            txHash: await getMultiSigTransactionHash(envelope.transaction),
            nonce: envelope.transaction.value.nonce,
            signedCount: envelope.signature.type === 'MultiSig' ? envelope.signature.value.signatures.length : 0,
            quorum: envelope.signature.type === 'MultiSig' ? Number(envelope.signature.value.config.quorum) : 0,
          }),
        ),
    );
    return {
      address: new Uint8Array(address),
      nextNonce,
      pendingConfirmation: account.pendingConfirmation,
      pending,
    };
  }

  /** Fetch validator state and current-nonce proposals without signing. */
  async getState(): Promise<MultiSigState> {
    return this.fetchState();
  }

  /** Build, but do not sign, the exact transaction payload. */
  async prepare(params: PrepareMultiSigTransactionParams): Promise<PreparedMultiSigTransaction> {
    this.assertSigner(params.signer);
    const state = await this.fetchState();
    if (state.pendingConfirmation != null) {
      throw new MultiSigWorkflowError(
        'PENDING_CONFIRMATION',
        'A transaction is awaiting validator confirmation; refusing to prepare another transaction at this nonce.',
      );
    }
    if (state.pending.length > 0 && !params.replacePending) {
      throw new MultiSigWorkflowError(
        'PENDING_REPLACEMENT',
        `${state.pending.length} proposal(s) already exist at nonce ${state.nextNonce}; set replacePending only after inspecting them.`,
      );
    }
    const transaction = await params.signer.buildTransaction({
      networkId: this.networkId,
      nonce: state.nextNonce,
      operations: [...params.operations],
      version: params.version,
      archival: params.archival,
      feeToken: params.feeToken,
    });
    return {
      transaction,
      txHash: await getMultiSigTransactionHash(transaction),
      nonce: state.nextNonce,
      replacedProposalHashes: state.pending.map((entry) => entry.txHash),
    };
  }

  /** Sign and submit the exact transaction returned by {@link prepare}. */
  async submitPrepared(params: SubmitPreparedMultiSigTransactionParams): Promise<MultiSigSubmission> {
    // Snapshot caller-owned input before the first await. Hashing and signing
    // then operate only on this private graph, closing mutation races between
    // integrity validation and signature serialization.
    const transaction = structuredClone(params.prepared.transaction);
    const expectedHash = params.prepared.txHash;
    const replacedProposalHashes = params.prepared.replacedProposalHashes.map(normalizeTxHash);
    this.assertSigner(params.signer);
    const preparedHash = await getMultiSigTransactionHash(transaction);
    if (preparedHash !== expectedHash) {
      throw new MultiSigWorkflowError('PREPARED_PAYLOAD_MISMATCH', 'Prepared transaction hash does not match its payload.');
    }
    const state = await this.fetchState();
    if (state.pendingConfirmation != null) {
      throw new MultiSigWorkflowError('PENDING_CONFIRMATION', 'A transaction is awaiting validator confirmation.');
    }
    if (transaction.value.nonce !== state.nextNonce) {
      throw new MultiSigWorkflowError('STALE_NONCE', `Prepared nonce ${transaction.value.nonce} no longer matches current nonce ${state.nextNonce}.`);
    }
    const competing = state.pending.filter((entry) => entry.txHash !== preparedHash);
    const unapprovedCompeting = competing.filter((entry) => !replacedProposalHashes.includes(normalizeTxHash(entry.txHash)));
    if (competing.length > 0 && (!params.replacePending || unapprovedCompeting.length > 0)) {
      throw new MultiSigWorkflowError(
        'PENDING_REPLACEMENT',
        `${unapprovedCompeting.length || competing.length} competing proposal(s) were not approved for replacement at nonce ${state.nextNonce}.`,
      );
    }
    this.assertTransaction(transaction);
    this.assertSender(transaction, state.address);
    const envelope = await params.signer.signEnvelopeFor(transaction);
    return this.submit(envelope, preparedHash);
  }

  /** Convenience path for automation that has already inspected its inputs. */
  async initiate(params: PrepareMultiSigTransactionParams): Promise<MultiSigSubmission> {
    const prepared = await this.prepare(params);
    return this.submitPrepared({ signer: params.signer, prepared, replacePending: params.replacePending });
  }

  /** Validate, sign, and submit an existing current-nonce proposal. */
  async vote(params: VoteMultiSigTransactionParams): Promise<MultiSigSubmission> {
    this.assertSigner(params.signer);
    const state = await this.fetchState();
    if (state.pendingConfirmation != null) {
      throw new MultiSigWorkflowError('PENDING_CONFIRMATION', 'A transaction is already awaiting validator confirmation.');
    }
    if (state.pending.length === 0) {
      throw new MultiSigWorkflowError('NO_PENDING_TRANSACTION', `No proposal exists at nonce ${state.nextNonce}.`);
    }
    const normalized = normalizeTxHash(params.txHash);
    const candidates = normalized ? state.pending.filter((entry) => normalizeTxHash(entry.txHash) === normalized) : [];
    if (candidates.length === 0) {
      throw new MultiSigWorkflowError('TRANSACTION_NOT_FOUND', `No current proposal matches ${params.txHash}.`);
    }
    if (candidates.length > 1) {
      throw new MultiSigWorkflowError('AMBIGUOUS_PENDING_TRANSACTION', 'Multiple proposals exist at the current nonce; select one by txHash.');
    }
    const selected = candidates[0]!;
    this.assertEnvelope(selected.envelope, state.address);
    const envelope = await params.signer.signEnvelopeFor(selected.envelope.transaction);
    return this.submit(envelope, selected.txHash);
  }

  private assertTransaction(transaction: VersionedTransaction): void {
    if (transaction.value.networkId !== this.networkId) {
      throw new MultiSigWorkflowError('NETWORK_MISMATCH', `Transaction network ${transaction.value.networkId} does not match ${this.networkId}.`);
    }
  }

  private assertSender(transaction: VersionedTransaction, expectedAddress: Uint8Array): void {
    if (!bytesEqual(transaction.value.sender, expectedAddress)) {
      throw new MultiSigWorkflowError('SENDER_MISMATCH', 'Transaction sender does not match this multisig address.');
    }
  }

  private assertEnvelope(envelope: TransactionEnvelope, expectedAddress: Uint8Array): void {
    if (!bytesEqual(envelope.transaction.value.sender, expectedAddress)) {
      throw new MultiSigWorkflowError('SENDER_MISMATCH', 'Pending transaction sender does not match this multisig address.');
    }
    this.assertTransaction(envelope.transaction);
    if (!envelopeConfigMatches(envelope, this.config)) {
      throw new MultiSigWorkflowError('CONFIG_MISMATCH', 'Pending transaction config does not match this multisig workflow.');
    }
  }

  private async submit(envelope: TransactionEnvelope, txHash: string): Promise<MultiSigSubmission> {
    let submitResult: SubmitTransactionResult;
    try {
      submitResult = await this.provider.submitTransaction(envelope);
    } catch (cause) {
      throw new MultiSigSubmissionUnknownError({
        txHash,
        nonce: envelope.transaction.value.nonce,
        envelope,
        cause,
      });
    }
    if (submitResult.type === 'IncompleteMultiSig') {
      return {
        status: 'pending-signatures',
        envelope,
        txHash,
        nonce: envelope.transaction.value.nonce,
        submitResult,
      };
    }
    if (submitResult.type === 'Success') {
      return {
        status: 'submitted',
        envelope,
        txHash,
        nonce: envelope.transaction.value.nonce,
        submitResult,
      };
    }
    if (submitResult.type === 'IncompleteVerifierSigs') {
      return {
        status: 'pending-verifier-signatures',
        envelope,
        txHash,
        nonce: envelope.transaction.value.nonce,
        submitResult,
      };
    }
    const unexpectedType = (submitResult as { type?: string }).type ?? 'unknown';
    throw new MultiSigWorkflowError('UNEXPECTED_SUBMIT_RESULT', `Submit returned ${unexpectedType}; the workflow will not report it as success.`);
  }
}
