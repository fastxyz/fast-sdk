import type { SubmitTransactionResult, TransactionEnvelope } from '@fastxyz/schema';
import { getPublicKeyAsync } from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import {
  InvalidRequestError,
  IpRateLimitedError,
  ProxyUnexpectedNonceError,
  ServiceUnavailableError,
  VerifierSigsInvalidError,
} from '../../src/core/error/proxy.js';
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

const successCertificate = (envelope: TransactionEnvelope): SubmitTransactionResult =>
  ({
    type: 'Success',
    value: {
      envelope,
      signatures: envelope.signature.type === 'MultiSig' ? envelope.signature.value.signatures : [],
    },
  }) as SubmitTransactionResult;

const makeProvider = (state: {
  nextNonce?: bigint;
  pendingConfirmation?: unknown | null;
  pending?: TransactionEnvelope[];
  pendingSequence?: TransactionEnvelope[][];
  submitResult?: SubmitTransactionResult | ((envelope: TransactionEnvelope) => SubmitTransactionResult);
  submitError?: unknown;
  onGetAccountInfo?: () => void;
  submitMutate?: (envelope: TransactionEnvelope) => void;
  submitted?: TransactionEnvelope[];
}) =>
  (() => {
    let pendingCall = 0;
    return {
      getAccountInfo: async () => {
        state.onGetAccountInfo?.();
        return {
          nextNonce: state.nextNonce ?? 9n,
          pendingConfirmation: state.pendingConfirmation ?? null,
        };
      },
      getPendingMultisigTransactions: async () => {
        if (state.pendingSequence) {
          return state.pendingSequence[Math.min(pendingCall++, state.pendingSequence.length - 1)] ?? [];
        }
        return state.pending ?? [];
      },
      submitTransaction: async (envelope: TransactionEnvelope) => {
        state.submitted?.push(envelope);
        state.submitMutate?.(envelope);
        if (state.submitError !== undefined) throw state.submitError;
        const submitResult = typeof state.submitResult === 'function' ? state.submitResult(envelope) : state.submitResult;
        return submitResult ?? ({ type: 'IncompleteMultiSig', value: null } as SubmitTransactionResult);
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

  it('rejects a success certificate for a different transaction and preserves recovery identity', async () => {
    const { config, first } = await fixture();
    const wrongCertificate = await first.signTransaction({
      networkId: 'fast:testnet',
      nonce: 9n,
      operations: [{ ...transfer, value: { ...transfer.value, amount: 8n } }],
    });
    const submitted: TransactionEnvelope[] = [];
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ submitted, submitResult: () => successCertificate(wrongCertificate) }),
      networkId: 'fast:testnet',
      config,
    });

    const error = await workflow.initiate({ signer: first, operations: [transfer] }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(MultiSigSubmissionUnknownError);
    expect(submitted).toHaveLength(1);
    const submittedHash = await getMultiSigTransactionHash(submitted[0]!.transaction);
    expect((error as MultiSigSubmissionUnknownError).txHash).toBe(submittedHash);
    expect((error as MultiSigSubmissionUnknownError).envelope).toEqual(submitted[0]);
    expect((error as MultiSigSubmissionUnknownError).cause).toMatchObject({ code: 'UNEXPECTED_SUBMIT_RESULT' });
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

  it('normalizes an unclonable prepared payload as a mismatch', async () => {
    const { config, first } = await fixture();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({}),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer] });
    (prepared.transaction.value as unknown as { invalid: () => void }).invalid = () => undefined;

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

  it('does not trust a caller-mutated replacement allowlist', async () => {
    const { config, first } = await fixture();
    const original = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const replacement = await first.signTransaction({
      networkId: 'fast:testnet',
      nonce: 9n,
      operations: [{ ...transfer, value: { ...transfer.value, amount: 8n } }],
    });
    const replacementHash = await getMultiSigTransactionHash(replacement.transaction);
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ pendingSequence: [[original], [original, replacement]] }),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer], replacePending: true });
    (prepared.replacedProposalHashes as string[]).push(replacementHash);

    await expect(workflow.submitPrepared({ signer: first, prepared, replacePending: true })).rejects.toMatchObject({
      code: 'PENDING_REPLACEMENT',
    });
  });

  it('captures prepare operations before provider awaits', async () => {
    const { config, first } = await fixture();
    const params = { signer: first, operations: [transfer] };
    const replacement = { ...transfer, value: { ...transfer.value, amount: 8n } };
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ onGetAccountInfo: () => (params.operations = [replacement]) }),
      networkId: 'fast:testnet',
      config,
    });

    const prepared = await workflow.prepare(params);
    const claim = (prepared.transaction.value as unknown as { claims: Array<typeof transfer> }).claims[0]!;
    expect(claim.value.amount).toBe(7n);
  });

  it('votes on a bound current-nonce proposal and supports deliberate retry', async () => {
    const { config, first, second } = await fixture();
    const pending = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const submitted: TransactionEnvelope[] = [];
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({
        pending: [pending],
        submitted,
        submitResult: successCertificate,
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

  it('votes over a private envelope snapshot when the provider object changes during signing', async () => {
    const { config, first, second } = await fixture();
    const pending = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const submitted: TransactionEnvelope[] = [];
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ pending: [pending], submitted, submitResult: successCertificate }),
      networkId: 'fast:testnet',
      config,
    });
    const txHash = await getMultiSigTransactionHash(pending.transaction);
    const mutatingSigner = {
      config: second.config,
      signEnvelopeFor: async (transaction: Parameters<MultiSigSigner['signEnvelopeFor']>[0]) => {
        (pending.transaction.value as { nonce: bigint }).nonce = 10n;
        return second.signEnvelopeFor(transaction);
      },
    } as MultiSigSigner;

    const result = await workflow.vote({ signer: mutatingSigner, txHash });

    expect(pending.transaction.value.nonce).toBe(10n);
    expect(submitted[0]!.transaction.value.nonce).toBe(9n);
    expect(result.txHash).toBe(await getMultiSigTransactionHash(submitted[0]!.transaction));
  });

  it('rejects a pending envelope that changes to a non-current nonce before snapshot', async () => {
    const { config, first, second } = await fixture();
    const pending = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const mutated = structuredClone(pending);
    (mutated.transaction.value as { nonce: bigint }).nonce = 10n;
    const mutatedHash = await getMultiSigTransactionHash(mutated.transaction);
    let nonceReads = 0;
    Object.defineProperty(pending.transaction.value, 'nonce', {
      configurable: true,
      enumerable: true,
      get: () => (nonceReads++ === 0 ? 9n : 10n),
    });
    const submitted: TransactionEnvelope[] = [];
    let signCalls = 0;
    const signer = {
      config: second.config,
      signEnvelopeFor: async (transaction: Parameters<MultiSigSigner['signEnvelopeFor']>[0]) => {
        signCalls += 1;
        return second.signEnvelopeFor(transaction);
      },
    } as MultiSigSigner;
    const workflow = new MultiSigWorkflow({
      provider: {
        getAccountInfo: async () => ({ nextNonce: 9n, pendingConfirmation: null }),
        getPendingMultisigTransactions: async () => [pending],
        submitTransaction: async (envelope: TransactionEnvelope) => {
          submitted.push(envelope);
          return successCertificate(envelope);
        },
      } as never,
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.vote({ signer, txHash: mutatedHash })).rejects.toMatchObject({ code: 'STALE_NONCE' });
    expect(signCalls).toBe(0);
    expect(submitted).toHaveLength(0);
  });

  it('captures the requested vote hash before provider awaits', async () => {
    const { config, first, second } = await fixture();
    const proposalA = await first.signTransaction({ networkId: 'fast:testnet', nonce: 9n, operations: [transfer] });
    const proposalB = await first.signTransaction({
      networkId: 'fast:testnet',
      nonce: 9n,
      operations: [{ ...transfer, value: { ...transfer.value, amount: 8n } }],
    });
    const hashA = await getMultiSigTransactionHash(proposalA.transaction);
    const hashB = await getMultiSigTransactionHash(proposalB.transaction);
    const submitted: TransactionEnvelope[] = [];
    const params = { signer: second, txHash: hashA };
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({
        pending: [proposalA, proposalB],
        submitted,
        submitResult: successCertificate,
        onGetAccountInfo: () => (params.txHash = hashB),
      }),
      networkId: 'fast:testnet',
      config,
    });

    const result = await workflow.vote(params);

    expect(result.txHash).toBe(hashA);
    expect(await getMultiSigTransactionHash(submitted[0]!.transaction)).toBe(hashA);
  });

  it('captures submitPrepared authorization before provider awaits', async () => {
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
    const params = { signer: first, prepared, replacePending: true };
    const guardedWorkflow = new MultiSigWorkflow({
      provider: makeProvider({
        pendingSequence: [[original], [original, replacement]],
        onGetAccountInfo: () => (params.replacePending = false),
      }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(guardedWorkflow.submitPrepared(params)).resolves.toMatchObject({ status: 'pending-signatures' });
  });

  it('captures the submitPrepared signer before provider awaits', async () => {
    const { config, first, second } = await fixture();
    const preparingWorkflow = new MultiSigWorkflow({
      provider: makeProvider({}),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await preparingWorkflow.prepare({ signer: first, operations: [transfer] });
    const submitted: TransactionEnvelope[] = [];
    const params = { signer: first, prepared };
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({
        submitted,
        onGetAccountInfo: () => (params.signer = second),
      }),
      networkId: 'fast:testnet',
      config,
    });

    await workflow.submitPrepared(params);

    const signerPublicKey = submitted[0]!.signature.value.signatures[0]![0];
    expect(signerPublicKey).toEqual(await first.getSignerPublicKey());
    expect(signerPublicKey).not.toEqual(await second.getSignerPublicKey());
  });

  it('captures initiate signer before provider awaits', async () => {
    const { config, first } = await fixture();
    const differentSigner = new MultiSigSigner({ config: { ...config, nonce: 1n }, secretKey: seed(0x11) });
    const params = { signer: first, operations: [transfer] };
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ onGetAccountInfo: () => (params.signer = differentSigner) }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.initiate(params)).resolves.toMatchObject({ status: 'pending-signatures' });
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

  it('rejects a payload and hash mutated together after prepare', async () => {
    const { config, first } = await fixture();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({}),
      networkId: 'fast:testnet',
      config,
    });
    const prepared = await workflow.prepare({ signer: first, operations: [transfer] });
    const claim = (prepared.transaction.value as unknown as { claims: Array<typeof transfer> }).claims[0]!;
    (claim.value as { amount: bigint }).amount = 8n;
    (prepared as { txHash: string }).txHash = await getMultiSigTransactionHash(prepared.transaction);

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

  it.each([
    ['proxy nonce rejection', () => new ProxyUnexpectedNonceError({ message: 'nonce rejected', txNonce: 9n, expectedNonce: 10n })],
    ['invalid request rejection', () => new InvalidRequestError({ message: 'request rejected' })],
    ['rate limit rejection', () => new IpRateLimitedError({ message: 'rate limited', retryAfterSecs: 3 })],
    ['service unavailable rejection', () => new ServiceUnavailableError({ message: 'unavailable' })],
    ['verifier signature rejection', () => new VerifierSigsInvalidError({ message: 'invalid verifier signatures' })],
  ])('preserves a definitive %s from submission', async (_label, makeError) => {
    const { config, first } = await fixture();
    const definitive = makeError();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({ submitError: definitive }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.initiate({ signer: first, operations: [transfer] })).rejects.toBe(definitive);
  });

  it('preserves a private recovery envelope when the provider mutates before throwing', async () => {
    const { config, first } = await fixture();
    const workflow = new MultiSigWorkflow({
      provider: makeProvider({
        submitError: new Error('timeout'),
        submitMutate: (envelope) => {
          (envelope.transaction.value as { nonce: bigint }).nonce = 10n;
        },
      }),
      networkId: 'fast:testnet',
      config,
    });

    await expect(workflow.initiate({ signer: first, operations: [transfer] })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(MultiSigSubmissionUnknownError);
      expect((error as MultiSigSubmissionUnknownError).nonce).toBe(9n);
      expect((error as MultiSigSubmissionUnknownError).envelope.transaction.value.nonce).toBe(9n);
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
