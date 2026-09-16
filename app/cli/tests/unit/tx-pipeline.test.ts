import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import { canonicalizeMultiSigSigners, MultiSigSigner, Signer } from '@fastxyz/sdk';
import { submitOperation } from '../../src/services/tx-pipeline';
import { FastRpc } from '../../src/services/api/fast';

const SECRET = new Uint8Array(32).fill(0xaa);

describe('submitOperation (single-signer)', () => {
  it('builds, signs, and submits a TokenTransfer; returns Success with hash', async () => {
    const signer = new Signer(SECRET);

    let submitCalls = 0;
    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 7n }) as never,
      submitTransaction: (_envelope: unknown) =>
        Effect.sync(() => {
          submitCalls++;
          return { type: 'Success', certificate: { stub: true } } as never;
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

  it('returns incomplete-multisig (txHash null) when proxy says IncompleteMultiSig', async () => {
    const signer = new Signer(SECRET);

    const rpcStub = Layer.succeed(FastRpc, {
      getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 0n }) as never,
      submitTransaction: (_envelope: unknown) => Effect.succeed({ type: 'IncompleteMultiSig' }) as never,
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

    expect(result.status).toBe('incomplete-multisig');
    expect(result.txHash).toBeNull();
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
