/**
 * Tests for Fast BCS decoding
 */

import { describe, it, expect } from 'vitest';
import {
  TransactionBcs,
  VersionedTransactionBcs,
  decodeEnvelope,
  getTransferDetails,
  bytesToHex,
  hexToBytes,
  serializeFastTransaction,
  unwrapFastTransaction,
} from '../src/fast-bcs.js';

function createTransaction() {
  const sender = new Uint8Array(32).fill(0x01);
  const recipient = new Uint8Array(32).fill(0x02);
  const tokenId = new Uint8Array(32);
  tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);

  return {
    network_id: 'fast:testnet',
    sender,
    nonce: 1,
    timestamp_nanos: BigInt(1709712000000) * 1_000_000n,
    claim: {
      TokenTransfer: {
        token_id: tokenId,
        recipient,
        amount: 1_000_000n,
        user_data: null,
      },
    },
    archival: false,
    fee_token: null,
  };
}

describe('Fast BCS utilities', () => {
  describe('bytesToHex', () => {
    it('converts bytes to hex string with 0x prefix', () => {
      const bytes = new Uint8Array([0x01, 0x02, 0x03, 0xff]);
      expect(bytesToHex(bytes)).toBe('0x010203ff');
    });

    it('handles empty bytes', () => {
      const bytes = new Uint8Array([]);
      expect(bytesToHex(bytes)).toBe('0x');
    });
  });

  describe('hexToBytes', () => {
    it('converts hex string to bytes', () => {
      const result = hexToBytes('0x010203ff');
      expect(result).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0xff]));
    });

    it('handles hex without 0x prefix', () => {
      const result = hexToBytes('010203ff');
      expect(result).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0xff]));
    });
  });

  describe('VersionedTransactionBcs', () => {
    it('serializes the current Release20260319 transaction format', () => {
      const transaction = createTransaction();
      const serialized = serializeFastTransaction(transaction);
      const parsed = VersionedTransactionBcs.parse(serialized);
      const inner = unwrapFastTransaction(parsed);
      const transfer = 'TokenTransfer' in inner.claim ? inner.claim.TokenTransfer : undefined;

      expect(inner.network_id).toBe('fast:testnet');
      expect(Array.from(inner.sender as any)).toEqual(Array.from(transaction.sender));
      expect(Number(inner.nonce)).toBe(1);
      expect(Array.from(transfer?.recipient as any)).toEqual(Array.from(transaction.claim.TokenTransfer.recipient));
    });

    it('can still parse bare current transaction bytes', () => {
      const transaction = createTransaction();
      const serialized = serializeFastTransaction(transaction);
      const decoded = decodeEnvelope(serialized);

      expect(decoded.network_id).toBe('fast:testnet');
      expect(Array.from(decoded.sender as any)).toEqual(Array.from(transaction.sender));
      expect(Array.from((decoded.claim as any).TokenTransfer?.recipient as any)).toEqual(Array.from(transaction.claim.TokenTransfer.recipient));
    });
  });

  describe('serializeFastTransaction — format variants', () => {
    // Reference bytes from BCS-native format
    const referenceTransaction = createTransaction();
    const referenceBytes = serializeFastTransaction(referenceTransaction);

    it('handles camelCase keys with typed variants (Effect Schema decoded format)', () => {
      const camelCase = {
        networkId: 'fast:testnet',
        sender: new Uint8Array(32).fill(0x01),
        nonce: 1n,
        timestampNanos: BigInt(1709712000000) * 1_000_000n,
        claim: {
          type: 'TokenTransfer',
          value: {
            tokenId: referenceTransaction.claim.TokenTransfer.token_id,
            recipient: new Uint8Array(32).fill(0x02),
            amount: 1_000_000n,
            userData: null,
          },
        },
        archival: false,
        feeToken: null,
      };

      const serialized = serializeFastTransaction(camelCase);
      expect(Array.from(serialized)).toEqual(Array.from(referenceBytes));
    });

    it('handles camelCase keys after JSON roundtrip (string bigints + number arrays)', () => {
      // Simulates what the facilitator receives from x402-client via HTTP:
      // bigints become decimal strings, Uint8Arrays become number arrays
      const jsonRoundtripped = {
        networkId: 'fast:testnet',
        sender: Array.from(new Uint8Array(32).fill(0x01)),
        nonce: '1',
        timestampNanos: String(BigInt(1709712000000) * 1_000_000n),
        claim: {
          type: 'TokenTransfer',
          value: {
            tokenId: Array.from(referenceTransaction.claim.TokenTransfer.token_id),
            recipient: Array.from(new Uint8Array(32).fill(0x02)),
            amount: '1000000',
            userData: null,
          },
        },
        archival: false,
        feeToken: null,
      };

      const serialized = serializeFastTransaction(jsonRoundtripped);
      expect(Array.from(serialized)).toEqual(Array.from(referenceBytes));
    });

    it('handles RPC wire format (snake_case keys + keyed variants)', () => {
      const rpcFormat = {
        Release20260319: createTransaction(),
      };

      const serialized = serializeFastTransaction(rpcFormat as any);
      expect(Array.from(serialized)).toEqual(Array.from(referenceBytes));
    });
  });

  describe('unwrapFastTransaction — format variants', () => {
    it('unwraps RPC wire format (keyed variant)', () => {
      const transaction = createTransaction();
      const result = unwrapFastTransaction({ Release20260319: transaction });
      expect(result.network_id).toBe('fast:testnet');
    });

    it('unwraps Effect schema decoded format (typed variant)', () => {
      const transaction = createTransaction();
      const result = unwrapFastTransaction({ type: 'Release20260319', value: transaction });
      expect((result as any).network_id ?? (result as any).networkId).toBeDefined();
    });

    it('unwraps already-unwrapped snake_case format', () => {
      const transaction = createTransaction();
      const result = unwrapFastTransaction(transaction);
      expect(result.network_id).toBe('fast:testnet');
    });

    it('unwraps already-unwrapped camelCase format', () => {
      const result = unwrapFastTransaction({ networkId: 'fast:testnet', sender: new Uint8Array(32) });
      expect((result as any).networkId).toBe('fast:testnet');
    });

    it('throws on unrecognized format', () => {
      expect(() => unwrapFastTransaction({ foo: 'bar' })).toThrow('unsupported_fast_transaction_format');
    });
  });

  describe('decodeEnvelope', () => {
    it('decodes a valid Release20260319 TokenTransfer envelope', () => {
      const transaction = createTransaction();
      const envelopeHex = bytesToHex(serializeFastTransaction(transaction));
      const decoded = decodeEnvelope(envelopeHex);

      expect(decoded.network_id).toBe('fast:testnet');
      expect(Array.from(decoded.sender as any)).toEqual(Array.from(transaction.sender));
      expect(BigInt(decoded.nonce)).toBe(1n);
      expect(decoded.archival).toBe(false);
      expect(decoded.fee_token).toBeNull();
      expect((decoded.claim as any).TokenTransfer).toBeDefined();
      expect(Array.from((decoded.claim as any).TokenTransfer?.recipient as any)).toEqual(Array.from(transaction.claim.TokenTransfer.recipient));
    });

    it('throws on invalid hex', () => {
      expect(() => decodeEnvelope('not-valid-hex')).toThrow();
    });

    it('throws on truncated data', () => {
      expect(() => decodeEnvelope('0x0102')).toThrow();
    });
  });

  describe('getTransferDetails', () => {
    it('extracts transfer details from decoded transaction', () => {
      const transaction = createTransaction();
      const decoded = decodeEnvelope(serializeFastTransaction(transaction));
      const details = getTransferDetails(decoded);

      expect(details).not.toBeNull();
      expect(details!.sender).toBe(bytesToHex(transaction.sender));
      expect(details!.recipient).toBe(bytesToHex(transaction.claim.TokenTransfer.recipient));
      expect(details!.amount).toBe(1_000_000n);
      expect(details!.tokenId).toBe(bytesToHex(transaction.claim.TokenTransfer.token_id));
    });

    it('returns null for non-TokenTransfer transactions', () => {
      const decoded = {
        network_id: 'fast:testnet',
        sender: new Uint8Array(32),
        nonce: 0n,
        timestamp_nanos: 0n,
        claim: {
          Mint: {
            token_id: new Uint8Array(32),
            recipient: new Uint8Array(32),
            amount: '1000',
          },
        },
        archival: false,
        fee_token: null,
      };

      const details = getTransferDetails(decoded as Parameters<typeof getTransferDetails>[0]);
      expect(details).toBeNull();
    });
  });
});
