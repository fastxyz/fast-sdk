import { parse } from '@optique/core/parser';
import { describe, expect, it } from 'vitest';
import { fundSelectorCommandParser, fundUsdcAppCommandParserWithOptions, parser } from '../../src/cli.js';

describe('fund command routing', () => {
  it.each([
    [['fund', 'card'], 'fund-card'],
    [['fund', 'crypto', '--supplier', 'coinbase'], 'fund-crypto-app'],
    [['fund', 'crypto', '--supplier', 'swapper'], 'fund-crypto-app'],
    [['fund', 'usdc', 'fiat'], 'fund-usdc-fiat'],
    [['fund', 'usdc', 'crypto', '5', '--chain', 'base'], 'fund-usdc-crypto'],
  ] as const)('parses %j as %s', (argv, command) => {
    const result = parse(parser, [...argv]);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) expect(result.value.cmd).toBe(command);
  });

  it('requires an explicit supported supplier for app crypto links', () => {
    expect(parse(parser, ['fund', 'crypto']).success).toBe(false);
  });

  it('parses bare fund as the interactive method selector', () => {
    const result = parse(fundSelectorCommandParser, ['fund']);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.cmd).toBe('fund-selector');
  });

  it('parses bare fund usdc as the direct hosted USDC link', () => {
    const result = parse(fundUsdcAppCommandParserWithOptions, ['fund', 'usdc']);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.cmd).toBe('fund-usdc-app');
  });
});
