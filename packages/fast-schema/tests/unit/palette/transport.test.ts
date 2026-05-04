import { bech32m } from 'bech32';
import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { TransactionCertificateFromTransport } from '../../../src/palette/transport.ts';
import { TransactionCertificateFromRest } from '../../../src/palette/rest.ts';
import { bytes32 } from '../helpers.ts';

// Minimal fake certificate fixture in REST-encoded shape but with bigint nonces
// stringified to simulate a port-mangled payload.
//
// Address: bech32m for 32 bytes (0xab fill) - valid encoded form
// Signature: 128 hex chars (64 bytes)
// Nonce / timestamp: STRING form (post-port-mangling)
const ADDR_BYTES = bytes32(0xab);
const ADDR_BECH32 = bech32m.encode('fast', bech32m.toWords(ADDR_BYTES));

const STRINGY_CERT_FIXTURE = {
  envelope: {
    transaction: {
      Release20260407: {
        network_id: 'fast:testnet',
        sender: ADDR_BECH32,
        nonce: '9999999999999999999',           // string form, > 2^53
        timestamp_nanos: '1700000000000000000', // string form, > 2^53
        claims: [],
        archival: false,
        fee_token: null,
      },
    },
    signature: { Signature: '0'.repeat(128) },
  },
  signatures: [],
};

describe('TransportPalette accepts post-port-mangling string forms', () => {
  it('TransactionCertificateFromTransport decodes string-form nonce', () => {
    const decoded = Schema.decodeUnknownSync(TransactionCertificateFromTransport)(STRINGY_CERT_FIXTURE);
    // After decode the value should be a bigint preserving full precision
    const tx = (decoded.envelope.transaction as { type: string; value: { nonce: bigint } }).value;
    expect(tx.nonce).toBe(9999999999999999999n);
  });

  it('TransactionCertificateFromRest rejects the same string-form nonce (regression guard for Task 16)', () => {
    // This currently FAILS — RestPalette still accepts string. Task 16 tightens
    // it; this test will pass once that lands.
    expect(() =>
      Schema.decodeUnknownSync(TransactionCertificateFromRest)(STRINGY_CERT_FIXTURE),
    ).toThrow();
  });
});
