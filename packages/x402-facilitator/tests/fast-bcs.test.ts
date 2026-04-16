/**
 * Tests for Fast BCS decoding — covers both Release20260319 and Release20260407.
 */

import { describe, it, expect } from 'vitest';
import type { DecodedFastTransaction20260319, DecodedFastTransaction20260407 } from '../src/fast-bcs.js';
import {
  TransactionBcs,
  Transaction20260407Bcs,
  VersionedTransactionBcs,
  decodeEnvelope,
  getTransferDetails,
  bytesToHex,
  hexToBytes,
  serializeFastTransaction,
  unwrapFastTransaction,
  unwrapFastTransactionVersioned,
} from '../src/fast-bcs.js';

const sender = new Uint8Array(32).fill(0x01);
const recipient = new Uint8Array(32).fill(0x02);
const tokenId = new Uint8Array(32);
tokenId.set([0x1b, 0x48, 0x76, 0x61], 0);

function createTransaction20260319() {
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

function createTransaction20260407() {
  return {
    network_id: 'fast:testnet',
    sender,
    nonce: 1,
    timestamp_nanos: BigInt(1709712000000) * 1_000_000n,
    claims: [
      {
        TokenTransfer: {
          token_id: tokenId,
          recipient,
          amount: 1_000_000n,
          user_data: null,
        },
      },
    ],
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

  // ─── Release20260319 ─────────────────────────────────────────────────────────

  describe('VersionedTransactionBcs (Release20260319)', () => {
    it('serializes and round-trips a Release20260319 transaction', () => {
      const transaction = createTransaction20260319();
      const serialized = serializeFastTransaction(transaction);
      const parsed = VersionedTransactionBcs.parse(serialized);
      const inner = unwrapFastTransaction(parsed);
      const transfer = 'TokenTransfer' in (inner as any).claim ? (inner as any).claim.TokenTransfer : undefined;

      expect(inner.network_id).toBe('fast:testnet');
      expect(Array.from(inner.sender as any)).toEqual(Array.from(transaction.sender));
      expect(Number(inner.nonce)).toBe(1);
      expect(Array.from(transfer?.recipient as any)).toEqual(Array.from(transaction.claim.TokenTransfer.recipient));
    });

    it('detects Release20260319 version via unwrapFastTransactionVersioned', () => {
      const transaction = createTransaction20260319();
      const serialized = serializeFastTransaction(transaction);
      const parsed = VersionedTransactionBcs.parse(serialized);
      const { version, inner } = unwrapFastTransactionVersioned(parsed);

      expect(version).toBe('Release20260319');
      expect(inner.network_id).toBe('fast:testnet');
    });

    it('decodes a Release20260319 envelope', () => {
      const transaction = createTransaction20260319();
      const serialized = serializeFastTransaction(transaction);
      const decoded = decodeEnvelope(serialized);

      expect(decoded.version).toBe('Release20260319');
      expect(decoded.network_id).toBe('fast:testnet');
      expect(Array.from(decoded.sender as any)).toEqual(Array.from(transaction.sender));
      const d = decoded as DecodedFastTransaction20260319;
      expect((d.claim as any).TokenTransfer).toBeDefined();
      expect(Array.from((d.claim as any).TokenTransfer?.recipient as any)).toEqual(Array.from(transaction.claim.TokenTransfer.recipient));
    });

    it('extracts transfer details from Release20260319 decoded transaction', () => {
      const transaction = createTransaction20260319();
      const decoded = decodeEnvelope(serializeFastTransaction(transaction));
      const details = getTransferDetails(decoded);

      expect(details).not.toBeNull();
      expect(details!.sender).toBe(bytesToHex(transaction.sender));
      expect(details!.recipient).toBe(bytesToHex(transaction.claim.TokenTransfer.recipient));
      expect(details!.amount).toBe(1_000_000n);
      expect(details!.tokenId).toBe(bytesToHex(transaction.claim.TokenTransfer.token_id));
    });

    it('returns null for non-TokenTransfer Release20260319 transactions', () => {
      const decoded = {
        version: 'Release20260319' as const,
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

    it('extracts transfer details from typed variant format', () => {
      const transaction = createTransaction20260319();

      const typedDecoded = {
        version: 'Release20260319' as const,
        network_id: 'fast:testnet',
        sender: transaction.sender,
        nonce: 1n,
        timestamp_nanos: BigInt(1709712000000) * 1_000_000n,
        claim: {
          type: 'TokenTransfer',
          value: {
            tokenId: transaction.claim.TokenTransfer.token_id,
            recipient: transaction.claim.TokenTransfer.recipient,
            amount: 1_000_000n,
            userData: null,
          },
        },
        archival: false,
        fee_token: null,
      };

      const details = getTransferDetails(typedDecoded as Parameters<typeof getTransferDetails>[0]);
      expect(details).not.toBeNull();
      expect(details!.sender).toBe(bytesToHex(transaction.sender));
      expect(details!.recipient).toBe(bytesToHex(transaction.claim.TokenTransfer.recipient));
      expect(details!.amount).toBe(1_000_000n);
      expect(details!.tokenId).toBe(bytesToHex(transaction.claim.TokenTransfer.token_id));
    });
  });

  // ─── Release20260407 ─────────────────────────────────────────────────────────

  describe('VersionedTransactionBcs (Release20260407)', () => {
    it('serializes and round-trips a Release20260407 transaction', () => {
      const transaction = createTransaction20260407();
      const serialized = serializeFastTransaction(transaction);
      const parsed = VersionedTransactionBcs.parse(serialized);
      const { version, inner } = unwrapFastTransactionVersioned(parsed);

      expect(version).toBe('Release20260407');
      expect(inner.network_id).toBe('fast:testnet');
      expect(Array.isArray((inner as any).claims)).toBe(true);
    });

    it('serializes a wrapped Release20260407 transaction', () => {
      const transaction = createTransaction20260407();
      const wrapped = { Release20260407: transaction };
      const serialized = serializeFastTransaction(wrapped);
      const decoded = decodeEnvelope(serialized);

      expect(decoded.version).toBe('Release20260407');
      expect(decoded.network_id).toBe('fast:testnet');
    });

    it('decodes a Release20260407 envelope', () => {
      const transaction = createTransaction20260407();
      const serialized = serializeFastTransaction(transaction);
      const decoded = decodeEnvelope(serialized);

      expect(decoded.version).toBe('Release20260407');
      expect(decoded.network_id).toBe('fast:testnet');
      const d = decoded as DecodedFastTransaction20260407;
      expect(Array.isArray(d.claims)).toBe(true);
      expect(d.claims.length).toBe(1);
      expect((d.claims[0] as any).TokenTransfer).toBeDefined();
    });

    it('extracts transfer details from Release20260407 decoded transaction', () => {
      const transaction = createTransaction20260407();
      const decoded = decodeEnvelope(serializeFastTransaction(transaction));
      const details = getTransferDetails(decoded);

      expect(details).not.toBeNull();
      expect(details!.sender).toBe(bytesToHex(transaction.sender));
      expect(details!.recipient).toBe(bytesToHex(transaction.claims[0].TokenTransfer.recipient));
      expect(details!.amount).toBe(1_000_000n);
      expect(details!.tokenId).toBe(bytesToHex(transaction.claims[0].TokenTransfer.token_id));
    });

    it('returns null for Release20260407 with no TokenTransfer ops', () => {
      const decoded = {
        version: 'Release20260407' as const,
        network_id: 'fast:testnet',
        sender: new Uint8Array(32),
        nonce: 0n,
        timestamp_nanos: 0n,
        claims: [
          {
            Mint: {
              token_id: new Uint8Array(32),
              recipient: new Uint8Array(32),
              amount: '1000',
            },
          },
        ],
        archival: false,
        fee_token: null,
      };

      const details = getTransferDetails(decoded as Parameters<typeof getTransferDetails>[0]);
      expect(details).toBeNull();
    });
  });

  // ─── Format variant tests (from PR #79) ────────────────────────────────────

  describe('serializeFastTransaction — format variants', () => {
    const referenceTransaction = createTransaction20260319();
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
        Release20260319: createTransaction20260319(),
      };

      const serialized = serializeFastTransaction(rpcFormat as any);
      expect(Array.from(serialized)).toEqual(Array.from(referenceBytes));
    });
  });

  describe('unwrapFastTransaction — format variants', () => {
    it('unwraps RPC wire format (keyed variant)', () => {
      const transaction = createTransaction20260319();
      const result = unwrapFastTransaction({ Release20260319: transaction });
      expect(result.network_id).toBe('fast:testnet');
    });

    it('unwraps Effect schema decoded format (typed variant)', () => {
      const transaction = createTransaction20260319();
      const result = unwrapFastTransaction({ type: 'Release20260319', value: transaction });
      expect((result as any).network_id ?? (result as any).networkId).toBeDefined();
    });

    it('unwraps already-unwrapped snake_case format', () => {
      const transaction = createTransaction20260319();
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

  // ─── Common ────────────────────────────────────────────────────────────────────

  describe('decodeEnvelope edge cases', () => {
    it('decodes hex-encoded envelopes', () => {
      const transaction = createTransaction20260319();
      const envelopeHex = bytesToHex(serializeFastTransaction(transaction));
      const decoded = decodeEnvelope(envelopeHex);

      expect(decoded.version).toBe('Release20260319');
      expect(decoded.network_id).toBe('fast:testnet');
      expect(BigInt(decoded.nonce)).toBe(1n);
      expect(decoded.archival).toBe(false);
      expect(decoded.fee_token).toBeNull();
    });

    it('throws on invalid hex', () => {
      expect(() => decodeEnvelope('not-valid-hex')).toThrow();
    });

    it('throws on truncated data', () => {
      expect(() => decodeEnvelope('0x0102')).toThrow();
    });
  });

  describe('unwrapFastTransaction', () => {
    it('unwraps Release20260319 wrapped transactions', () => {
      const transaction = createTransaction20260319();
      const wrapped = { Release20260319: transaction };
      const inner = unwrapFastTransaction(wrapped);
      expect(inner.network_id).toBe('fast:testnet');
      expect('claim' in inner).toBe(true);
    });

    it('unwraps Release20260407 wrapped transactions', () => {
      const transaction = createTransaction20260407();
      const wrapped = { Release20260407: transaction };
      const inner = unwrapFastTransaction(wrapped);
      expect(inner.network_id).toBe('fast:testnet');
      expect('claims' in inner).toBe(true);
    });

    it('passes through bare transactions', () => {
      const transaction = createTransaction20260319();
      const inner = unwrapFastTransaction(transaction);
      expect(inner.network_id).toBe('fast:testnet');
    });

    it('throws for unsupported formats', () => {
      expect(() => unwrapFastTransaction('string')).toThrow('unsupported_fast_transaction_format');
      expect(() => unwrapFastTransaction({ unknown_version: {} })).toThrow('unsupported_fast_transaction_format');
    });
  });
});
