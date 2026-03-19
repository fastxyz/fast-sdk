import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAST_TOKEN_ID,
  getCertificateHash,
  getCertificateTokenTransfer,
  getCertificateTransaction,
  hashTransaction,
  type FastTransaction,
  type FastTransactionCertificate,
} from '../src/browser.js';
import { FAST_NETWORK_IDS } from '../src/core/bcs.js';

const SENDER = new Uint8Array(32).fill(1);
const RECIPIENT = new Uint8Array(32).fill(2);

function createTransferCertificate(): FastTransactionCertificate {
  const transaction: FastTransaction = {
    network_id: FAST_NETWORK_IDS.TESTNET,
    sender: SENDER,
    nonce: 7,
    timestamp_nanos: 123n,
    claim: {
      TokenTransfer: {
        token_id: FAST_TOKEN_ID,
        recipient: RECIPIENT,
        amount: 'de0b6b3a7640000',
        user_data: null,
      },
    },
    archival: false,
    fee_token: null,
  };

  return {
    envelope: {
      transaction: { Release20260319: transaction },
      signature: { Signature: Array.from(new Uint8Array(64).fill(9)) },
    },
    signatures: [],
  };
}

describe('certificate helpers', () => {
  it('unwraps the transaction from a certificate', () => {
    const certificate = createTransferCertificate();
    const transaction = getCertificateTransaction(certificate);
    assert.equal(transaction.nonce, 7);
    assert.ok('TokenTransfer' in transaction.claim);
  });

  it('hashes the same transaction payload used by the certificate', () => {
    const certificate = createTransferCertificate();
    const transaction = getCertificateTransaction(certificate);
    assert.equal(getCertificateHash(certificate), hashTransaction(transaction));
  });

  it('extracts token transfer details from the certificate', () => {
    const certificate = createTransferCertificate();
    const summary = getCertificateTokenTransfer(certificate);
    assert.ok(summary);
    assert.equal(summary.tokenId, 'native');
    assert.equal(summary.amountHex, '0xde0b6b3a7640000');
    assert.equal(summary.amount, '1');
    assert.ok(summary.sender.startsWith('fast1'));
    assert.ok(summary.recipient.startsWith('fast1'));
  });
});
