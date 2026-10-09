import { buildIntentClaimBytes, buildTransferIntent } from '@fastxyz/allset-sdk';
import { describe, expect, it } from 'vitest';
import { summarizeTransaction } from '../../src/services/transaction-summary.js';

describe('AllSet intent cosigner summary', () => {
  it('shows the linked transfer, fixed deadline, token and destination without hiding raw bytes', () => {
    const claimData = buildIntentClaimBytes({
      transferFastTxId: `0x${'11'.repeat(32)}`,
      deadline: 123456n,
      intents: [buildTransferIntent(`0x${'22'.repeat(20)}`, `0x${'33'.repeat(20)}`)],
    });
    const envelope = {
      transaction: {
        type: 'V2',
        value: {
          sender: new Uint8Array(32),
          nonce: 1n,
          networkId: 'fast:testnet',
          claims: [{ type: 'ExternalClaim', value: { claim: { claimData, verifierCommittee: [], verifierQuorum: 0n }, signatures: [] } }],
        },
      },
    };
    const text = summarizeTransaction(envelope as never).join('\n');
    expect(text).toContain('AllSet legacy withdrawal intent (decoded, not authenticated)');
    expect(text).toContain(`Transfer: 0x${'11'.repeat(32)}`);
    expect(text).toContain('Deadline: 123456');
    expect(text).toContain(`Token: 0x${'22'.repeat(20)}`);
    expect(text).toContain(`Recipient: 0x${'33'.repeat(20)}`);
    expect(text).toContain('claimData');
  });
  it('leaves unrelated external claims as raw data', () => {
    const envelope = {
      transaction: {
        type: 'V2',
        value: {
          sender: new Uint8Array(32),
          nonce: 1n,
          claims: [{ type: 'ExternalClaim', value: { claim: { claimData: new Uint8Array([1, 2]) } } }],
        },
      },
    };
    const text = summarizeTransaction(envelope as never).join('\n');
    expect(text).not.toContain('AllSet legacy');
    expect(text).toContain('0x0102');
  });
});
