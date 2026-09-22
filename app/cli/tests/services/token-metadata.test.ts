import { describe, expect, it } from 'vitest';
import { findRequestedTokenMetadata } from '../../src/services/token-metadata.js';

const requested = new Uint8Array(32).fill(0xaa);
const unrelated = new Uint8Array(32).fill(0xbb);

describe('findRequestedTokenMetadata', () => {
  it('selects the requested token regardless of response order', () => {
    expect(
      findRequestedTokenMetadata(
        [
          [unrelated, { decimals: 2 }],
          [requested, { decimals: 6 }],
        ],
        requested,
      ),
    ).toEqual({ decimals: 6 });
  });

  it.each([
    ['missing', [[unrelated, { decimals: 2 }]]],
    ['null metadata', [[requested, null]]],
    ['duplicate matching rows', [[requested, { decimals: 6 }], [requested, { decimals: 8 }]]],
  ] as const)('returns null for %s', (_label, rows) => {
    expect(findRequestedTokenMetadata(rows, requested)).toBeNull();
  });
});
