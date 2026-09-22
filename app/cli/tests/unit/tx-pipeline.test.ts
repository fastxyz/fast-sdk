import { describe, expect, it } from 'vitest';
import { TransactionEnvelopeFromRest } from '@fastxyz/schema';
import { Effect, Layer, Schema } from 'effect';
import { canonicalizeMultiSigSigners, MultiSigSigner, ProxyUnexpectedNonceError, RestError, Signer } from '@fastxyz/sdk';
import { FastSdkError, TransactionFailedError, TransactionSubmissionUnknownError } from '../../src/errors/index';
import { submitOperation } from '../../src/services/tx-pipeline';
import { FastRpc } from '../../src/services/api/fast';

const SECRET = new Uint8Array(32).fill(0xaa);

describe('submitOperation (single-signer)', () => {
  it('preserves recovery when a success certificate names another transaction', async () => {
    const signer = new Signer(SECRET);

    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (envelope: unknown) => {
        const certificateEnvelope = structuredClone(envelope as object) as any;
        certificateEnvelope.transaction.value.nonce = 8n;
        return Effect.succeed({ type: 'Success', value: { envelope: certificateEnvelope } }) as never;
      },
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(TransactionSubmissionUnknownError);
  });

  it('preserves recovery when a success certificate uses another network', async () => {
    const signer = new Signer(SECRET);
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (envelope: unknown) => {
        const certificateEnvelope = structuredClone(envelope as object) as any;
        certificateEnvelope.transaction.value.networkId = 'fast:mainnet';
        return Effect.succeed({ type: 'Success', value: { envelope: certificateEnvelope } }) as never;
      },
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: { tokenId: new Uint8Array(32), recipient: new Uint8Array(32), amount: 1n, userData: null },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(TransactionSubmissionUnknownError);
  });

  it('preserves recovery when a success certificate is malformed', async () => {
    const signer = new Signer(SECRET);
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (_envelope: unknown) => Effect.succeed({ type: 'Success', value: { envelope: { transaction: null } } }) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: { tokenId: new Uint8Array(32), recipient: new Uint8Array(32), amount: 1n, userData: null },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(TransactionSubmissionUnknownError);
  });

  it('builds, signs, and submits a TokenTransfer; returns Success with hash', async () => {
    const signer = new Signer(SECRET);

    let submitCalls = 0;
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (envelope: unknown) =>
        Effect.sync(() => {
          submitCalls++;
          return { type: 'Success', value: { envelope } } as never;
        }) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const result = await Effect.runPromise(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(submitCalls).toBe(1);
    expect(result.status).toBe('success');
    expect(result.nonce).toBe(7n);
    expect(typeof result.txHash).toBe('string');
    expect(result.txHash?.startsWith('0x')).toBe(true);
  }, 15_000);

  it('fails instead of reporting a single-signer response as incomplete multisig', async () => {
    const signer = new Signer(SECRET);

    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 0n }) as never,
      submitTransaction: (_envelope: unknown) => Effect.succeed({ type: 'IncompleteMultiSig' }) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toMatchObject({
      errorCode: 'TX_FAILED',
      message: 'Unexpected IncompleteMultiSig response for single-signer transaction.',
    });
  });

  it('fails instead of finalizing when proxy says IncompleteVerifierSigs', async () => {
    const signer = new Signer(SECRET);

    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 0n }) as never,
      submitTransaction: (_envelope: unknown) => Effect.succeed({ type: 'IncompleteVerifierSigs' }) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('surfaces a recovery identity instead of an ordinary failure when the response is lost', async () => {
    const signer = new Signer(SECRET);
    let submittedEnvelope: unknown;
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (envelope: unknown) => {
        submittedEnvelope = envelope;
        return Effect.fail(new FastSdkError({ message: 'connection closed after request body' })) as never;
      },
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    const error = exit.cause.error;
    expect(error).toBeInstanceOf(TransactionSubmissionUnknownError);
    if (!(error instanceof TransactionSubmissionUnknownError)) throw new Error('expected unknown-submission error');
    expect(error.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(error.nonce).toBe(7n);
    expect(error.envelope).toBe(submittedEnvelope);
    expect(error.details).toMatchObject({ txHash: error.txHash, nonce: '7' });
    expect(error.details.recoveryEnvelope).toHaveProperty('transaction');
    expect(() => JSON.stringify(error.details)).not.toThrow();
    expect(Schema.decodeUnknownSync(TransactionEnvelopeFromRest)(error.details.recoveryEnvelope)).toEqual(submittedEnvelope);
    expect(error.message).toContain('Do not rebuild or retry this operation');
  });

  it('preserves a deterministic proxy rejection instead of reporting an unknown submission', async () => {
    const signer = new Signer(SECRET);
    const rejection = new ProxyUnexpectedNonceError({
      message: 'nonce 7 does not match expected nonce 8',
      txNonce: 7n,
      expectedNonce: 8n,
    });
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (_envelope: unknown) => Effect.fail(new FastSdkError({ message: rejection.message, cause: rejection })) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(TransactionFailedError);
    expect(exit.cause.error).toMatchObject({ errorCode: 'TX_FAILED', message: rejection.message });
    expect(exit.cause.error.cause).toBeInstanceOf(FastSdkError);
  });

  it('treats an opaque REST failure after submit as an unknown submission', async () => {
    const signer = new Signer(SECRET);
    const transportFailure = new RestError({
      status: 502,
      code: 'HTTP_502',
      message: 'upstream connection closed after accepting the request',
      details: null,
    });
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (_envelope: unknown) =>
        Effect.fail(new FastSdkError({ message: transportFailure.message, cause: transportFailure })) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'single', signer, account: {} as never },
        networkId: 'fast:testnet',
        operation: {
          type: 'TokenTransfer',
          value: {
            tokenId: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: 1n,
            userData: null,
          },
        },
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure' || exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(exit.cause.error).toBeInstanceOf(TransactionSubmissionUnknownError);
  });
});

describe('submitOperation (multisig replacement preflight)', () => {
  const makeFixture = async () => {
    const first = new Signer(new Uint8Array(32).fill(0x11));
    const second = new Signer(new Uint8Array(32).fill(0x22));
    const config = {
      authorized_signers: canonicalizeMultiSigSigners([await first.getPublicKey(), await second.getPublicKey()]),
      quorum: 2n,
      nonce: 0n,
    };
    const signer = new MultiSigSigner({ config, secretKey: new Uint8Array(32).fill(0x11) });
    const operation = {
      type: 'TokenTransfer' as const,
      value: {
        tokenId: new Uint8Array(32),
        recipient: new Uint8Array(32).fill(0x44),
        amount: 1n,
        userData: null,
      },
    };
    const pending = await signer.signTransaction({
      networkId: 'fast:testnet',
      nonce: 4n,
      operations: [operation],
    });
    return { signer, operation, pending };
  };

  it('refuses when the preflight observes a proposal at the current nonce', async () => {
    const { signer, operation, pending } = await makeFixture();
    let submitCalls = 0;
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 4n }) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([pending]) as never,
      submitTransaction: (_envelope: unknown) =>
        Effect.sync(() => {
          submitCalls++;
          return { type: 'IncompleteMultiSig' } as never;
        }) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const exit = await Effect.runPromiseExit(
      submitOperation({
        resolved: { kind: 'multisig', signer, account: {} as never, memberAccount: {} as never },
        networkId: 'fast:testnet',
        operation,
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(exit._tag).toBe('Failure');
    expect(submitCalls).toBe(0);
  });

  it('allows replacement of an observed proposal after explicit opt-in', async () => {
    const { signer, operation, pending } = await makeFixture();
    let submitCalls = 0;
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 4n }) as never,
      getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([pending]) as never,
      submitTransaction: (_envelope: unknown) =>
        Effect.sync(() => {
          submitCalls++;
          return { type: 'IncompleteMultiSig' } as never;
        }) as never,
      getTokenInfo: (_p: unknown) => Effect.succeed({}) as never,
      getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
      getRpcUrl: () => Effect.succeed('http://test'),
    } as unknown as never);

    const result = await Effect.runPromise(
      submitOperation({
        resolved: { kind: 'multisig', signer, account: {} as never, memberAccount: {} as never },
        networkId: 'fast:testnet',
        operation,
        replacePending: true,
      }).pipe(Effect.provide(rpcStub)),
    );

    expect(result.status).toBe('incomplete-multisig');
    expect(submitCalls).toBe(1);
  });
});
