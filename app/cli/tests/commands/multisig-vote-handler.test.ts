import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeMultiSigSigners, deriveMultiSigAddress, fromFastAddress, ProxyUnexpectedNonceError, Signer, toFastAddress } from '@fastxyz/sdk';
import Db from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { multisigVote } from '../../src/commands/multisig/vote.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { DatabaseError, FastSdkError, TransactionFailedError, TransactionSubmissionUnknownError } from '../../src/errors/index.js';
import type { HistoryEntry } from '../../src/schemas/history.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { resolveSigner } from '../../src/services/signer-resolver.js';
import { AccountStore } from '../../src/services/storage/account.js';
import { DatabaseService } from '../../src/services/storage/database.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const seed = (value: number) => new Uint8Array(32).fill(value);

type VoteScenario = {
  readonly asMember: 'alice' | 'bob';
  readonly submitType: 'Success' | 'IncompleteMultiSig' | 'IncompleteVerifierSigs';
  readonly historyFailure?: boolean;
  readonly metadataFailure?: boolean;
  readonly submitFailure?: boolean;
  readonly deterministicSubmitFailure?: boolean;
  readonly mismatchedSuccessCertificate?: boolean;
};

const runVoteScenario = async ({
  asMember,
  submitType,
  historyFailure = false,
  metadataFailure = false,
  submitFailure = false,
  deterministicSubmitFailure = false,
  mismatchedSuccessCertificate = false,
}: VoteScenario) => {
  const sqlite = new Db(join(mkdtempSync(join(tmpdir(), 'fast-vote-handler-')), 'fast.db'));
  try {
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
    const dbLayer = Layer.succeed(DatabaseService, {
      query: <A>(fn: (database: typeof db) => A) => Effect.sync(() => fn(db)),
    } as never);
    const accountsLayer = AccountStore.Default.pipe(Layer.provide(dbLayer));
    const lines: string[] = [];
    const confirmations: string[] = [];
    const debugLines: string[] = [];
    const history: HistoryEntry[] = [];
    const results: unknown[] = [];
    let submissions = 0;
    let metadataCalls = 0;

    const baseLayers = Layer.mergeAll(
      dbLayer,
      accountsLayer,
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: false,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(NetworkConfigService, {
        resolve: () => Effect.succeed(bundledNetworks.testnet!),
      } as never),
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
        ok: (data: unknown) => Effect.sync(() => void results.push(data)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: (line: string) => Effect.sync(() => void debugLines.push(line)),
      } as never),
      Layer.succeed(Prompt, {
        password: () => Effect.die('password prompt must not run'),
        input: () => Effect.die('input prompt must not run'),
        confirm: (message: string) =>
          Effect.sync(() => {
            confirmations.push(message);
            return true;
          }),
      } as never),
      Layer.succeed(HistoryStore, {
        record: (entry: HistoryEntry) =>
          historyFailure
            ? Effect.fail(new DatabaseError({ message: 'history database unavailable', cause: new Error('disk full') }))
            : Effect.sync(() => void history.push(entry)),
      } as never),
    );

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create('alice', seed(1), null);
        yield* accounts.create('bob', seed(2), null);
        yield* accounts.create('carol', seed(3), null);
        const singles = yield* accounts.list();
        const signerAddresses = canonicalizeMultiSigSigners(singles.map((account) => fromFastAddress(account.fastAddress))).map(toFastAddress);
        const config = {
          authorized_signers: signerAddresses.map(fromFastAddress),
          quorum: 2n,
          nonce: 0n,
        };
        const fastAddress = yield* Effect.promise(() => deriveMultiSigAddress(config));
        yield* accounts.createMultiSig(
          {
            version: 1,
            name: 'treasury',
            signers: signerAddresses,
            quorum: 2,
            configNonce: '0',
            fastAddress,
            network: 'testnet',
          },
          true,
        );
        const treasury = yield* accounts.get('treasury');
        const alice = yield* resolveSigner({
          account: treasury,
          asMember: 'alice',
          network: 'testnet',
          password: null,
        });
        if (alice.kind !== 'multisig') throw new Error('expected multisig signer');
        const recipient = yield* Effect.promise(() => new Signer(seed(9)).getPublicKey());
        const envelope = yield* Effect.promise(() =>
          alice.signer.signTransaction({
            networkId: 'fast:testnet',
            nonce: 0n,
            operations: [
              {
                type: 'TokenTransfer',
                value: {
                  tokenId: new Uint8Array(32).fill(0xd7),
                  recipient,
                  amount: 100000n,
                  userData: null,
                },
              },
            ],
          }),
        );

        const rpcLayer = Layer.succeed(FastRpc, {
          getPendingMultisigTransactions: () => Effect.succeed([envelope]),
          getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
          getTokenInfo: () => {
            metadataCalls++;
            return metadataFailure
              ? Effect.fail(new FastSdkError({ message: 'metadata unavailable' }))
              : Effect.succeed({
                  requestedTokenMetadata: [[new Uint8Array(32).fill(0xd7), { tokenName: 'TEST', decimals: 6 }]],
                });
          },
          submitTransaction: (submittedEnvelope: unknown) => {
            submissions++;
            return deterministicSubmitFailure
              ? Effect.fail(
                  new FastSdkError({
                    message: 'nonce 0 does not match expected nonce 1',
                    cause: new ProxyUnexpectedNonceError({
                      message: 'nonce 0 does not match expected nonce 1',
                      txNonce: 0n,
                      expectedNonce: 1n,
                    }),
                  }),
                )
              : submitFailure
                ? Effect.fail(new FastSdkError({ message: 'connection closed after request body' }))
                : Effect.succeed({
                    type: submitType,
                    ...(submitType === 'Success'
                      ? {
                          value: {
                            envelope: mismatchedSuccessCertificate
                              ? (() => {
                                  const certificateEnvelope = structuredClone(submittedEnvelope as object) as any;
                                  certificateEnvelope.transaction.value.nonce = 1n;
                                  return certificateEnvelope;
                                })()
                              : submittedEnvelope,
                          },
                        }
                      : {}),
                  });
          },
        } as never);

        yield* multisigVote.handler({ asMember, yes: false } as never).pipe(Effect.provide(Layer.merge(baseLayers, rpcLayer)));
      }).pipe(Effect.provide(baseLayers)),
    );

    return { confirmations, debugLines, exit, history, lines, metadataCalls, results, submissions };
  } finally {
    sqlite.close();
  }
};

describe('multisig vote handler', () => {
  it('shows the exact transaction before the real confirmation and submission', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'IncompleteMultiSig' });
    const output = result.lines.join('\n');

    expect(result.exit._tag).toBe('Success');
    expect(output).toContain('[1] TokenTransfer');
    expect(output).toContain('"amount": "100000"');
    expect(output).toContain('fast:testnet');
    expect(output).toContain('Operations: 1');
    expect(result.confirmations).toEqual(['Sign and submit?']);
    expect(result.submissions).toBe(1);
    expect(result.metadataCalls).toBe(0);
  });

  it('preserves recovery when the vote is retained pending verifier signatures', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'IncompleteVerifierSigs' });

    expect(result.submissions).toBe(1);
    expect(result.exit._tag).toBe('Failure');
    if (result.exit._tag !== 'Failure' || result.exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    const error = result.exit.cause.error;
    expect(error).toBeInstanceOf(TransactionSubmissionUnknownError);
    if (!(error instanceof TransactionSubmissionUnknownError)) throw new Error('expected unknown-submission error');
    expect(error.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(error.nonce).toBe(0n);
    expect(error.details).toMatchObject({ txHash: error.txHash, nonce: '0' });
    expect(error.details.recoveryEnvelope).toHaveProperty('transaction');
    expect(error.message).toContain('Do not rebuild or retry this operation');
    expect(result.history).toHaveLength(0);
  });

  it('resubmits an already-recorded signature after explicit confirmation', async () => {
    const result = await runVoteScenario({ asMember: 'alice', submitType: 'IncompleteMultiSig' });

    expect(result.exit._tag).toBe('Success');
    expect(result.lines.join('\n')).toContain('your signature is already recorded; this will resubmit it');
    expect(result.confirmations).toEqual(['Resubmit existing signature?']);
    expect(result.submissions).toBe(1);
  });

  it('does not let a post-submit metadata failure hide successful quorum', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'Success', metadataFailure: true });

    expect(result.exit._tag).toBe('Success');
    expect(result.submissions).toBe(1);
    expect(result.metadataCalls).toBe(1);
    expect(result.lines.join('\n')).toContain('Quorum reached.');
    expect(result.history).toHaveLength(1);
    expect(result.history[0]!.tokenName).toMatch(/^0x/);
    expect(result.history[0]!.formatted).toBe('100000');
  });

  it('does not confirm quorum from a certificate for another transaction', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'Success', mismatchedSuccessCertificate: true });

    expect(result.exit._tag).toBe('Failure');
    expect(result.history).toHaveLength(0);
  });

  it('does not let a post-submit history failure hide successful quorum', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'Success', historyFailure: true });

    expect(result.exit._tag).toBe('Success');
    expect(result.submissions).toBe(1);
    expect(result.history).toHaveLength(0);
    expect(result.lines.join('\n')).toContain('confirmed, but local history could not be updated');
    expect(result.debugLines.join('\n')).toContain('disk full');
    expect(result.lines.join('\n')).toContain('Quorum reached.');
    expect(result.results).toEqual([
      expect.objectContaining({
        reachedQuorum: true,
        txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    ]);
  });

  it('surfaces the exact transaction identity when a final-vote response is lost', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'Success', submitFailure: true });

    expect(result.submissions).toBe(1);
    expect(result.exit._tag).toBe('Failure');
    if (result.exit._tag !== 'Failure' || result.exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    const error = result.exit.cause.error;
    expect(error).toBeInstanceOf(TransactionSubmissionUnknownError);
    if (!(error instanceof TransactionSubmissionUnknownError)) throw new Error('expected unknown-submission error');
    expect(error.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(error.nonce).toBe(0n);
    expect(error.details).toMatchObject({ txHash: error.txHash, nonce: '0' });
    expect(error.message).toContain('Do not rebuild or retry this operation');
    expect(result.history).toHaveLength(0);
  });

  it('surfaces a deterministic proxy rejection as a failed vote, not an unknown submission', async () => {
    const result = await runVoteScenario({ asMember: 'bob', submitType: 'Success', deterministicSubmitFailure: true });

    expect(result.submissions).toBe(1);
    expect(result.exit._tag).toBe('Failure');
    if (result.exit._tag !== 'Failure' || result.exit.cause._tag !== 'Fail') throw new Error('expected typed failure');
    expect(result.exit.cause.error).toBeInstanceOf(TransactionFailedError);
    expect(result.exit.cause.error).toMatchObject({
      errorCode: 'TX_FAILED',
      message: 'nonce 0 does not match expected nonce 1',
    });
    expect(result.exit.cause.error.cause).toBeInstanceOf(FastSdkError);
  });
});
