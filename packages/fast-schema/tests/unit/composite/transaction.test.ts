import { describe, expect, it } from 'vitest';
import {
  AccountInfoResponseFromRpc,
  ProxySubmitTransactionResultFromRpc,
  SubmitTransactionResponseFromRpc,
  TokenTransferFromRpc,
  TransactionCertificateFromRpc,
  TransactionEnvelopeFromRpc,
  TransactionFromRpc,
  VersionedTransactionFromRpc,
} from '../../../src/palette/rpc.ts';
import { decodeSync, encodeSync, numArray32, numArray64 } from '../helpers.ts';

const ADDR = numArray32(1);
const TOKEN_ID = numArray32(0x11);
const SIG = numArray64(0xcc);

const BURN_CLAIM = { Burn: { token_id: TOKEN_ID, amount: '64' } };

const TX_WIRE = {
  network_id: 'fast:testnet',
  sender: ADDR,
  nonce: 5,
  timestamp_nanos: 1000000000000,
  claim: BURN_CLAIM,
  archival: false,
  fee_token: null,
};

describe('TransactionFromRpc', () => {
  it('decodes full transaction', () => {
    const result = decodeSync(TransactionFromRpc, TX_WIRE);
    expect(result.networkId).toBe('fast:testnet');
    expect(result.sender).toBeInstanceOf(Uint8Array);
    expect(result.nonce).toBe(5n);
    expect(result.timestampNanos).toBe(1000000000000n);
    expect(result.claim.type).toBe('Burn');
    expect(result.archival).toBe(false);
    expect(result.feeToken).toBeNull();
  });

  it('round-trips (encode produces bigints for nonce/timestamp)', () => {
    const decoded = decodeSync(TransactionFromRpc, TX_WIRE);
    const encoded = encodeSync(TransactionFromRpc, decoded);
    expect(encoded.network_id).toBe('fast:testnet');
    expect(encoded.nonce).toBe(5n);
    expect(encoded.timestamp_nanos).toBe(1000000000000n);
    expect(encoded.archival).toBe(false);
  });
});

describe('VersionedTransactionFromRpc', () => {
  it('decodes Release20260319 variant', () => {
    const wire = { Release20260319: TX_WIRE };
    const result = decodeSync(VersionedTransactionFromRpc, wire);
    expect(result.type).toBe('Release20260319');
    expect(result.value.networkId).toBe('fast:testnet');
  });

  it('round-trips (encode produces bigints for nonce/timestamp)', () => {
    const wire = { Release20260319: TX_WIRE };
    const decoded = decodeSync(VersionedTransactionFromRpc, wire);
    const encoded = encodeSync(VersionedTransactionFromRpc, decoded) as {
      Release20260319: Record<string, unknown>;
    };
    expect(encoded.Release20260319.network_id).toBe('fast:testnet');
    expect(encoded.Release20260319.nonce).toBe(5n);
  });
});

describe('TransactionEnvelopeFromRpc', () => {
  it('decodes with Signature', () => {
    const wire = {
      transaction: { Release20260319: TX_WIRE },
      signature: { Signature: SIG },
    };
    const result = decodeSync(TransactionEnvelopeFromRpc, wire);
    expect(result.transaction.type).toBe('Release20260319');
    expect(result.signature.type).toBe('Signature');
    expect(result.signature.value).toBeInstanceOf(Uint8Array);
  });

  it('decodes with MultiSig', () => {
    const wire = {
      transaction: { Release20260319: TX_WIRE },
      signature: {
        MultiSig: {
          config: {
            authorized_signers: [ADDR],
            quorum: 1,
            nonce: 0,
          },
          signatures: [[ADDR, SIG]],
        },
      },
    };
    const result = decodeSync(TransactionEnvelopeFromRpc, wire);
    expect(result.signature.type).toBe('MultiSig');
  });
});

describe('TransactionCertificateFromRpc', () => {
  it('decodes nested envelope + validator signatures', () => {
    const wire = {
      envelope: {
        transaction: { Release20260319: TX_WIRE },
        signature: { Signature: SIG },
      },
      signatures: [[ADDR, SIG]],
    };
    const result = decodeSync(TransactionCertificateFromRpc, wire);
    expect(result.envelope.transaction.type).toBe('Release20260319');
    expect(result.signatures).toHaveLength(1);
  });
});

describe('Response schemas', () => {
  it('SubmitTransactionResponseFromRpc', () => {
    const wire = {
      validator: ADDR,
      signature: SIG,
      next_nonce: 6,
      transaction_hash: numArray32(0xdd),
    };
    const result = decodeSync(SubmitTransactionResponseFromRpc, wire);
    expect(result.validator).toBeInstanceOf(Uint8Array);
    expect(result.nextNonce).toBe(6n);
    expect(result.transactionHash).toBeInstanceOf(Uint8Array);
  });

  it('ProxySubmitTransactionResultFromRpc: Success variant', () => {
    const certWire = {
      envelope: {
        transaction: { Release20260319: TX_WIRE },
        signature: { Signature: SIG },
      },
      signatures: [[ADDR, SIG]],
    };
    const wire = { Success: certWire };
    const result = decodeSync(ProxySubmitTransactionResultFromRpc, wire);
    expect(result.type).toBe('Success');
  });

  it('ProxySubmitTransactionResultFromRpc: unit variant', () => {
    const result = decodeSync(ProxySubmitTransactionResultFromRpc, 'IncompleteVerifierSigs');
    expect(result).toEqual({ type: 'IncompleteVerifierSigs' });
  });

  it('AccountInfoResponseFromRpc: decodes basic fields', () => {
    const wire = {
      sender: ADDR,
      balance: '3e8',
      next_nonce: 5,
      pending_confirmation: null,
      requested_state: [],
      requested_certificates: [],
      requested_validated_transaction: null,
      token_balance: [],
    };
    const result = decodeSync(AccountInfoResponseFromRpc, wire);
    expect(result.sender).toBeInstanceOf(Uint8Array);
    expect(result.balance).toBe(1000n);
    expect(result.nextNonce).toBe(5n);
    expect(result.pendingConfirmation).toBeNull();
    expect(result.tokenBalance).toEqual([]);
  });
});

describe('Cross-palette round-trip', () => {
  it('TokenTransfer: RPC encode → decode preserves values', () => {
    const rpcWire = {
      token_id: TOKEN_ID,
      recipient: ADDR,
      amount: '3e8',
      user_data: null,
    };
    const decoded = decodeSync(TokenTransferFromRpc, rpcWire);
    const reEncoded = encodeSync(TokenTransferFromRpc, decoded);
    const reDecoded = decodeSync(TokenTransferFromRpc, reEncoded);
    expect(reDecoded.amount).toBe(decoded.amount);
    expect(reDecoded.tokenId).toEqual(decoded.tokenId);
  });
});
