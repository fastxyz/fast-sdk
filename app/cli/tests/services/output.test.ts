import { describe, expect, it, vi } from 'vitest';
import { TransactionSubmissionUnknownError } from '../../src/errors/index.js';
import { writeFail } from '../../src/services/output.js';

const unknownSubmission = () =>
  new TransactionSubmissionUnknownError({
    txHash: `0x${'ab'.repeat(32)}`,
    nonce: 7n,
    envelope: {} as never,
    recoveryEnvelope: { transaction: 'wire-transaction', signature: 'wire-signature' },
  });

describe('writeFail recovery details', () => {
  it('emits structured recovery data in JSON mode', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      writeFail(unknownSubmission(), true);
      const output = String(write.mock.calls[0]![0]);
      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        error: {
          code: 'TX_SUBMISSION_UNKNOWN',
          details: {
            nonce: '7',
            recoveryEnvelope: { transaction: 'wire-transaction', signature: 'wire-signature' },
          },
        },
      });
    } finally {
      write.mockRestore();
    }
  });

  it('prints the exact recovery data in human mode', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      writeFail(unknownSubmission(), false);
      const output = write.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('Do not rebuild or retry this operation');
      expect(output).toContain('Recovery details:');
      expect(output).toContain('wire-transaction');
    } finally {
      write.mockRestore();
    }
  });
});
