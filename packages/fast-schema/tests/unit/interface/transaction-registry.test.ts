import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  TransactionVersionRegistry,
  getTransactionVersionConfig,
  TransactionRelease20260319Input,
  TransactionRelease20260407Input,
  LatestTransactionVersion,
  type TransactionVersion,
} from '../../../src/index.ts';

describe('TransactionVersionRegistry', () => {
  describe('registry structure', () => {
    it('has entries for all known versions', () => {
      expect(TransactionVersionRegistry).toHaveProperty('Release20260319');
      expect(TransactionVersionRegistry).toHaveProperty('Release20260407');
    });

    it('each entry has required methods and inputSchema', () => {
      for (const [version, config] of Object.entries(TransactionVersionRegistry)) {
        expect(config.wrapOperations).toBeTypeOf('function');
        expect(config.extractOperations).toBeTypeOf('function');
        expect(config.inputSchema).toBeDefined();
      }
    });

    it('Release20260319 uses the correct input schema', () => {
      const config = TransactionVersionRegistry.Release20260319;
      expect(config.inputSchema).toBe(TransactionRelease20260319Input);
    });

    it('Release20260407 uses the correct input schema', () => {
      const config = TransactionVersionRegistry.Release20260407;
      expect(config.inputSchema).toBe(TransactionRelease20260407Input);
    });
  });

  describe('getTransactionVersionConfig', () => {
    it('returns config for valid version', () => {
      const config = getTransactionVersionConfig('Release20260407');
      expect(config).toBe(TransactionVersionRegistry.Release20260407);
    });

    it('throws for unknown version', () => {
      expect(() => getTransactionVersionConfig('Release99999999' as TransactionVersion)).toThrow(
        'Unknown transaction version',
      );
    });
  });

  describe('Release20260319 wrapOperations', () => {
    const config = TransactionVersionRegistry.Release20260319;

    it('wraps a single operation as direct claim', () => {
      const ops = [{ type: 'TokenTransfer' as const, value: { tokenId: '01'.repeat(32), recipient: '02'.repeat(32), amount: 1000n, userData: null } }];
      const result = config.wrapOperations(ops);
      expect(result).toEqual({ claim: ops[0] });
    });

    it('wraps multiple operations as Batch', () => {
      const op1 = { type: 'Burn' as const, value: { tokenId: '01'.repeat(32), amount: 100n } };
      const op2 = { type: 'Burn' as const, value: { tokenId: '01'.repeat(32), amount: 200n } };
      const result = config.wrapOperations([op1, op2]);
      expect(result).toEqual({ claim: { type: 'Batch', value: [op1, op2] } });
    });
  });

  describe('Release20260407 wrapOperations', () => {
    const config = TransactionVersionRegistry.Release20260407;

    it('wraps a single operation as claims array', () => {
      const ops = [{ type: 'TokenTransfer' as const, value: { tokenId: '01'.repeat(32), recipient: '02'.repeat(32), amount: 1000n, userData: null } }];
      const result = config.wrapOperations(ops);
      expect(result).toEqual({ claims: ops });
    });

    it('wraps multiple operations as claims array', () => {
      const op1 = { type: 'Burn' as const, value: { tokenId: '01'.repeat(32), amount: 100n } };
      const op2 = { type: 'Burn' as const, value: { tokenId: '01'.repeat(32), amount: 200n } };
      const result = config.wrapOperations([op1, op2]);
      expect(result).toEqual({ claims: [op1, op2] });
    });
  });

  describe('Release20260319 extractOperations', () => {
    const config = TransactionVersionRegistry.Release20260319;

    it('extracts single operation from BCS-decoded claim', () => {
      const decoded = { claim: { TokenTransfer: { token_id: new Uint8Array(32), recipient: new Uint8Array(32), amount: 1000n, user_data: null } } };
      const ops = config.extractOperations(decoded);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toBe(decoded.claim);
    });

    it('extracts operations from BCS-decoded Batch', () => {
      const op1 = { TokenTransfer: { token_id: new Uint8Array(32) } };
      const op2 = { Burn: { token_id: new Uint8Array(32) } };
      const decoded = { claim: { Batch: [op1, op2] } };
      const ops = config.extractOperations(decoded);
      expect(ops).toHaveLength(2);
      expect(ops[0]).toBe(op1);
      expect(ops[1]).toBe(op2);
    });

    it('extracts operations from serde/domain-typed Batch', () => {
      const op1 = { type: 'TokenTransfer', value: {} };
      const op2 = { type: 'Burn', value: {} };
      const decoded = { claim: { type: 'Batch', value: [op1, op2] } };
      const ops = config.extractOperations(decoded);
      expect(ops).toHaveLength(2);
    });

    it('returns empty for null claim', () => {
      expect(config.extractOperations({ claim: null })).toEqual([]);
    });
  });

  describe('Release20260407 extractOperations', () => {
    const config = TransactionVersionRegistry.Release20260407;

    it('extracts operations from claims array', () => {
      const op1 = { TokenTransfer: { token_id: new Uint8Array(32) } };
      const op2 = { Burn: { token_id: new Uint8Array(32) } };
      const decoded = { claims: [op1, op2] };
      const ops = config.extractOperations(decoded);
      expect(ops).toHaveLength(2);
      expect(ops[0]).toBe(op1);
      expect(ops[1]).toBe(op2);
    });

    it('returns empty for missing claims', () => {
      expect(config.extractOperations({})).toEqual([]);
    });
  });

  describe('round-trip: wrapOperations → schema decode works', () => {
    it('Release20260319 single op validates through schema', () => {
      const config = TransactionVersionRegistry.Release20260319;
      const ops = [{ type: 'LeaveCommittee' as const }];
      const wrapped = config.wrapOperations(ops);
      const input = {
        networkId: 'fast:testnet',
        sender: new Uint8Array(32),
        nonce: 0n,
        timestampNanos: 1000000n,
        ...wrapped,
        archival: false,
        feeToken: null,
      };
      const decoded = Schema.decodeUnknownSync(config.inputSchema)(input);
      expect(decoded.claim.type).toBe('LeaveCommittee');
    });

    it('Release20260407 single op validates through schema', () => {
      const config = TransactionVersionRegistry.Release20260407;
      const ops = [{ type: 'LeaveCommittee' as const }];
      const wrapped = config.wrapOperations(ops);
      const input = {
        networkId: 'fast:testnet',
        sender: new Uint8Array(32),
        nonce: 0n,
        timestampNanos: 1000000n,
        ...wrapped,
        archival: false,
        feeToken: null,
      };
      const decoded = Schema.decodeUnknownSync(config.inputSchema)(input);
      expect(decoded.claims).toHaveLength(1);
      expect(decoded.claims[0].type).toBe('LeaveCommittee');
    });
  });
});
