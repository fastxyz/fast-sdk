import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import {
  OperationRelease20260319,
  OperationRelease20260407,
  Release20260319SupportedOperations,
  Release20260407SupportedOperations,
} from '../../../src/composite/operations-per-version.ts';

describe('OperationRelease20260319', () => {
  it('decodes the LeaveCommittee unit variant from { LeaveCommittee: [] } (BCS form)', () => {
    const decoded = Schema.decodeUnknownSync(OperationRelease20260319)({
      LeaveCommittee: [],
    });
    expect(decoded.type).toBe('LeaveCommittee');
  });

  it('rejects an Escrow-shaped object (Escrow not in 20260319)', () => {
    expect(() => Schema.decodeUnknownSync(OperationRelease20260319)({
      Escrow: { CreateConfig: {} as never } as never,
    })).toThrow();
  });
});

describe('OperationRelease20260407', () => {
  it('decodes the LeaveCommittee unit variant from { LeaveCommittee: [] } (BCS form)', () => {
    const decoded = Schema.decodeUnknownSync(OperationRelease20260407)({
      LeaveCommittee: [],
    });
    expect(decoded.type).toBe('LeaveCommittee');
  });

  it('recognizes Escrow as a known variant tag (Escrow exists in 20260407)', () => {
    // We don't construct a fully-valid Escrow payload — just verify the tag
    // is recognized. Payload-shape validation is covered by Escrow's own tests.
    expect(() => Schema.decodeUnknownSync(OperationRelease20260407)({
      Escrow: { CreateConfig: {} as never } as never,
    })).not.toThrow(/Unknown variant|not in/i);
  });
});

describe('SupportedOperations drift guards', () => {
  it('Release20260319SupportedOperations excludes Escrow', () => {
    expect([...Release20260319SupportedOperations]).not.toContain('Escrow');
  });

  it('Release20260319SupportedOperations includes core ops', () => {
    const tags = [...Release20260319SupportedOperations];
    expect(tags).toContain('TokenTransfer');
    expect(tags).toContain('LeaveCommittee');
    expect(tags).toContain('Mint');
  });

  it('Release20260407SupportedOperations includes Escrow', () => {
    expect([...Release20260407SupportedOperations]).toContain('Escrow');
  });

  it('Release20260407 is a superset of Release20260319 in supported ops', () => {
    const v319 = new Set<string>(Release20260319SupportedOperations);
    const v407 = new Set<string>(Release20260407SupportedOperations);
    for (const tag of v319) {
      expect(v407.has(tag)).toBe(true);
    }
  });
});
