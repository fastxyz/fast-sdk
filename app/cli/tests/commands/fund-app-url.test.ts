import { describe, expect, it } from 'vitest';
import { buildFundAppUrl } from '../../src/commands/fund/app-link.js';

describe('buildFundAppUrl', () => {
  it.each([
    ['card', 'https://app.fast.xyz/card?to=fast1abc'],
    ['usdc', 'https://app.fast.xyz/usdc?to=fast1abc'],
    ['coinbase', 'https://app.fast.xyz/crypto?supplier=coinbase&to=fast1abc'],
    ['swapper', 'https://app.fast.xyz/crypto?supplier=swapper&to=fast1abc'],
  ] as const)('builds the supported %s funding link', (method, expected) => {
    expect(buildFundAppUrl(method, 'fast1abc')).toBe(expected);
  });

  it('URL-encodes the destination address', () => {
    expect(buildFundAppUrl('card', 'fast1abc&to=fast1attacker')).toBe('https://app.fast.xyz/card?to=fast1abc%26to%3Dfast1attacker');
  });
});
