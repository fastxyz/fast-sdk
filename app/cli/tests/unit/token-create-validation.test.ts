import { describe, expect, it } from 'vitest';
import { encodeMemo } from '../../src/commands/token/create.js';
import { InvalidUsageError } from '../../src/errors/index.js';

describe('token create validation', () => {
  it('classifies an overlong UTF-8 memo as invalid usage', () => {
    try {
      encodeMemo('x'.repeat(33));
      throw new Error('expected encodeMemo to reject the memo');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidUsageError);
      if (!(error instanceof InvalidUsageError)) throw error;
      expect(error.errorCode).toBe('INVALID_USAGE');
      expect(error.message).toBe('--memo too long: 33 bytes (max 32)');
    }
  });

  it('accepts and zero-pads a memo at the 32-byte limit', () => {
    const encoded = encodeMemo('x'.repeat(32));
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded).toHaveLength(32);
    expect(new TextDecoder().decode(encoded!)).toBe('x'.repeat(32));
  });
});
