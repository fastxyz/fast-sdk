import type { SubmitTransactionResult, TransactionEnvelope } from '@fastxyz/schema';
import { getPublicKeyAsync } from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import { canonicalizeMultiSigSigners, type MultiSigConfig, MultiSigSigner } from '../../src/interface/multisig-signer.js';
import {
  getMultiSigTransactionHash,
  MultiSigSigner as SubpathMultiSigSigner,
  MultiSigSubmissionUnknownError,
  MultiSigWorkflow,
  MultiSigWorkflowError,
  validateMultiSigConfig as subpathValidateMultiSigConfig,
} from '../../src/multisig/index.js';

const seed = (byte: number) => new Uint8Array(32).fill(byte);

const fixture = async () => {
  const firstSeed = seed(0x11);
  const secondSeed = seed(0x22);
  const config: MultiSigConfig = {
    authorized_signers: canonicalizeMultiSigSigners([await getPublicKeyAsync(firstSeed), await getPublicKeyAsync(secondSeed)]),
    quorum: 2n,
    nonce: 0n,
  };
  return {
    config,
    first: new MultiSigSigner({ config, secretKey: firstSeed }),
    second: new MultiSigSigner({ config, secretKey: secondSeed }),
  };
};

const transfer = {
  type: 'TokenTransfer' as const,
  value: {
    tokenId: new Uint8Array(32),
    recipient: new Uint8Array(32).fill(0x44),
    amount: 7n,
    userData: null,
  },
};

const makeProvider = (state: {
  nextNonce?: bigint;
  pendingConfirmation?: unknown | null;
  pending?: TransactionEnvelope[];
  pendingSequence?: TransactionEnvelope[][];
  submitResult?: SubmitTransactionResult;
  submitError?: unknown;
  submitted?: TransactionEnvelope[];
}) =>
  (() => {
    let pendingCall = 0;
    return {
      getAccountInfo: async () => ({
        nextNonce: state.nextNonce ?? 9n,
        pendingConfirmation: state.pendingConfirmation ?? null,
      }),
      getPendingMultisigTransactions: async () => {
        if (state.pendingSequence) {
          return state.pendingSequence[Math.min(pendingCall++, state.pendingSequence.length - 1)] ?? [];
        }
        return state.pending ?? [];
      },
      submitTransaction: async (envelope: TransactionEnvelope) => {
        state.submitted?.push(envelope);
        if (state.submitError !== undefined) throw state.submitError;
        return state.submitResult ?? ({ type: 'IncompleteMultiSig', value: null } as SubmitTransactionResult);
      },
    };
  })() as never;

describe('MultiSigWorkflow', () => {
  it('exports signer construction and validation from the multisig entry point', () => {
    expect(SubpathMultiSigSigner).toBe(MultiSigSigner);
    expect(subpathValidateMultiSigConfig).toBeTypeOf('function');
  });

  it('prepares an inspectable unsigned payload, then signs and submits those exact bytes', async () => {
    const { config, first } = await fixture();
    const submitted: TransactionEnvelope[] = [];
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ submitted }),
      networkId: 'fast:testnet',
      config,
    });

    const prepared = await workflow.prepare({ signer: first, operations: [transfer] });

    expect(submitted).toHaveLength(0);
    expect(prepared.nonce).toBe(9n);
    expect(prepared.transaction.value.networkId).toBe('fast:testnet');
    expect(prepared.transaction.value.nonce).toBe(9n);
    expect(prepared.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const result = await workflow.submitPrepared({ signer: first, prepared });
    expect(result.status).toBe('pending-signatures');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.transaction).not.toBe(prepared.transaction);
    expect(submitted[0]!.transaction).toEqual(prepared.transaction);
  });

  it('rejects a payload changed before submission with a dedicated stable code', async () => {
    const { config, first } = await fixture();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({}),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer] });
    const claim = (prepared.transaction.value as unknown as { claims: Array<typeof transfer> }).claims[0]!;
    (claim.value as { amount: bigint }).amount = 8n;

    await expect(workflow.submitPrepared({ signer: first, prepared })).rejects.toMatchObject({
      code: 'PREPARED_PAYLOAD_MISMATCH',
    });
  });

  it('snapshots prepared bytes before awaiting so concurrent caller mutation cannot change the signature', async () => {
    const { config, first } = await fixture();
    const submitted: TransactionEnvelope[] = [];
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ submitted }),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer] });
    const expectedHash = prepared.txHash;

    const submission = workflow.submitPrepared({ signer: first, prepared });
    const claim = (prepared.transaction.value as unknown as { claims: Array<typeof transfer> }).claims[0]!;
    (claim.value as { amount: bigint }).amount = 99n;
    const result = await submission;

    const submittedClaim = (submitted[0]!.transaction.value as unknown as { claims: Array<typeof transfer> }).claims[0]!;
    expect(submittedClaim.value.amount).toBe(7n);
    expect(result.txHash).toBe(expectedHash);
  });

  it('refuses implicit replacement and reports replaced hashes after explicit opt-in', async () => {
    const { config, first } = await fixture();
    const pending = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ pending: [pending] }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.prepare({ signer: first, operations: [transfer] })).rejects.toMatchObject({
      code: 'PENDING_REPLACEMENT',
    });

    const prepared = await workflow.prepare({ signer: first, operations: [transfer], replacePending: true });
    expect(prepared.replacedProposalHashes).toHaveLength(1);
  });

  it('votes on a bound current-nonce proposal and supports deliberate retry', async () => {
    const { config, first, second } = await fixture();
    const pending = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const submitted: TransactionEnvelope[] = [];
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({
        pending: [pending],
        submitted,
        submitResult: { type: 'Success', value: {} } as SubmitTransactionResult,
      }),
      networkId: 'fast:testnet',
      config,
    });

    const txHash = await getMultiSigTransactionHash(pending.transaction);
    const firstVote = await workflow.vote({ signer: second, txHash });
    const retry = await workflow.vote({ signer: second, txHash: firstVote.txHash });

    expect(firstVote.status).toBe('submitted');
    expect(retry.status).toBe('submitted');
    expect(submitted).toHaveLength(2);
    expect(submitted[0]!.transaction).toEqual(pending.transaction);
    expect(submitted[1]!.transaction).toEqual(pending.transaction);
  });

  it('requires an explicit non-empty transaction hash before voting', async () => {
    const { config, first, second } = await fixture();
    const pending = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ pending: [pending] }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.vote({ signer: second, txHash: '' })).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
    await expect(workflow.vote({ signer: second, txHash: '0x' })).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
  });

  it('rejects a newly competing proposal that was not present at prepare time', async () => {
    const { config, first } = await fixture();
    const original = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const replacement = await first.signTransaction({
      networkId: 'fast:testnet',
      nonce: 9n,
      operations: [{ ...transfer, value: { ...transfer.value, amount: 8n } }],
    });
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ pendingSequence: [[original], [original, replacement]] }),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer], replacePending: true });

    await expect(workflow.submitPrepared({ signer: first, prepared, replacePending: true })).rejects.toMatchObject({
      code: 'PENDING_REPLACEMENT',
    });
  });

  it('reports a mutated nonce as prepared payload corruption', async () => {
    const { config, first } = await fixture();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({}),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer] });
    (prepared.transaction.value as { nonce: bigint }).nonce = 10n;

    await expect(workflow.submitPrepared({ signer: first, prepared })).rejects.toMatchObject({
      code: 'PREPARED_PAYLOAD_MISMATCH',
    });
  });

  it('preserves recovery identity when submission transport is uncertain', async () => {
    const { config, first } = await fixture();
    const submitError = new Error('socket closed after request');
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ submitError }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.initiate({ signer: first, operations: [transfer] })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(MultiSigSubmissionUnknownError);
      expect((error as MultiSigSubmissionUnknownError).txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect((error as MultiSigSubmissionUnknownError).nonce).toBe(9n);
      expect((error as MultiSigSubmissionUnknownError).envelope.transaction.value.nonce).toBe(9n);
      expect((error as MultiSigSubmissionUnknownError).cause).toBe(submitError);
      return true;
    });
  });

  it('rejects a proposal from another sender before signing', async () => {
    const { config, second } = await fixture();
    const other = await fixture();
    const otherConfig: MultiSigConfig = {
      ...other.config,
      nonce: 1n,
    };
    const stranger = new MultiSigSigner({ config: otherConfig, secretKey: seed(0x11) });
    const pending = await stranger.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ pending: [pending] }),
      networkId: 'fast:testnet',
      config,
    });

    const txHash = await getMultiSigTransactionHash(pending.transaction);
    await expect(workflow.vote({ signer: second, txHash })).rejects.toMatchObject({ code: 'SENDER_MISMATCH' });
  });

  it('never reports verifier-pending as success', async () => {
    const { config, first } = await fixture();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ submitResult: { type: 'IncompleteVerifierSigs', value: null } as SubmitTransactionResult }),
      networkId: 'fast:testnet',
      config,
    });

    const result = await workflow.initiate({ signer: first, operations: [transfer] });
    expect(result.status).toBe('pending-verifier-signatures');
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
