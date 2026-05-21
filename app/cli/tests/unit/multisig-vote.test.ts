import type { TransactionEnvelope } from '@fastxyz/schema';
import { toFastAddress, toHex } from '@fastxyz/sdk';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { TransactionFailedError } from '../../src/errors/index.js';
import { makeVoteHistoryEntry, voteReachedQuorum } from '../../src/commands/multisig/vote.js';

describe('multisig vote helpers', () => {
  it('does not treat IncompleteVerifierSigs as finalized', async () => {
    const exit = await Effect.runPromiseExit(voteReachedQuorum({ type: 'IncompleteVerifierSigs' }));

    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') throw new Error('unreachable');
    const err = exit.cause._tag === 'Fail' ? exit.cause.error : null;
    expect(err).toBeInstanceOf(TransactionFailedError);
  });

  it('builds a history entry for finalized multisig transfer votes', () => {
    const sender = new Uint8Array(32).fill(0xaa);
    const recipient = new Uint8Array(32).fill(0xbb);
    const tokenId = new Uint8Array(32).fill(0xcc);
    const envelope = {
      transaction: {
        type: 'Release20260407',
        value: {
          sender,
          nonce: 7n,
          claims: [
            {
              type: 'TokenTransfer',
              value: {
                tokenId,
                recipient,
                amount: 123n,
                userData: null,
              },
            },
          ],
          archival: false,
          feeToken: null,
        },
      },
      signature: {
        type: 'MultiSig',
        value: {
          config: { authorizedSigners: [sender, recipient], quorum: 2n, nonce: 0n },
          signatures: [],
        },
      },
    } as unknown as TransactionEnvelope;

    const entry = makeVoteHistoryEntry({
      envelope,
      txHash: `0x${'11'.repeat(32)}`,
      walletFastAddress: toFastAddress(sender),
      network: 'testnet',
      explorerUrl: 'https://explorer.test/txs/0xabc',
    });

    expect(entry).not.toBeNull();
    expect(entry?.type).toBe('transfer');
    expect(entry?.from).toBe(toFastAddress(sender));
    expect(entry?.to).toBe(toFastAddress(recipient));
    expect(entry?.amount).toBe('123');
    expect(entry?.tokenId).toBe(toHex(tokenId));
    expect(entry?.status).toBe('confirmed');
  });
});
