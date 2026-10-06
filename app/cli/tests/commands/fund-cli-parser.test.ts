import { parse } from '@optique/core/parser';
import { describe, expect, it } from 'vitest';
import { bareFundCommand, fundSelectorCommandParser, fundUsdcAppCommandParserWithOptions, parser } from '../../src/cli.js';
import { diagnoseFundUsdcArgv } from '../../src/commands/fund/app-routes.js';

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

  it.each([
    [['--network', 'mainnet', 'fund'], 'selector', 'fund-selector'],
    [['--json', 'fund', 'usdc'], 'usdc-app', 'fund-usdc-app'],
    [['--network=mainnet', '--json', 'fund', 'usdc'], 'usdc-app', 'fund-usdc-app'],
    [['fund', '--network', 'mainnet'], 'selector', 'fund-selector'],
  ] as const)('routes %j with global options before or after the command', (argv, route, command) => {
    expect(bareFundCommand(argv)).toBe(route);
    const selectedParser = route === 'selector' ? fundSelectorCommandParser : fundUsdcAppCommandParserWithOptions;
    const result = parse(selectedParser, [...argv]);
    expect(result.success, JSON.stringify(result)).toBe(true);
    if (result.success) expect(result.value.cmd).toBe(command);
  });

  it('leaves nested fund commands on the regular parser', () => {
    expect(bareFundCommand(['--network', 'mainnet', 'fund', 'usdc', 'crypto', '5', '--chain', 'base'])).toBeNull();
  });
});

describe('diagnoseFundUsdcArgv (command lines the parser rejects)', () => {
  const ADDRESS = 'fast1ncwsez3lu627e404k5kn4dnsuyggz5fddvy4zsxd5nm9ulf68hhsh9at23';

  it('does not report an option value as an unknown subcommand', () => {
    // The app USDC route takes no --amount, so this fails to parse; the message must be about
    // --amount, not "Unknown subcommand 'fast1...'".
    const argv = ['fund', 'usdc', '--address', ADDRESS, '--amount', '1'];
    expect(parse(fundUsdcAppCommandParserWithOptions, argv).success).toBe(false);
    expect(diagnoseFundUsdcArgv(argv)).toBeUndefined();
    expect(diagnoseFundUsdcArgv(['--network', 'mainnet', 'fund', 'usdc', 'crypto', '5', '--chain', 'base', '--token', 'USDC'])).toBeUndefined();
  });

  it('leaves the value of an unknown option to the unknown-option message', () => {
    // `--bogus value`: `value` is most likely --bogus's value, not a subcommand.
    expect(diagnoseFundUsdcArgv(['fund', 'usdc', '--bogus', 'value'])).toBeUndefined();
    expect(diagnoseFundUsdcArgv(['--network', 'mainnet', 'fund', 'usdc', '--address', ADDRESS, '--bogus', 'value'])).toBeUndefined();
  });

  it('reports a real unknown subcommand', () => {
    const message = "Unknown subcommand 'bogus' for 'fund usdc'. Use no subcommand for the app USDC flow, or choose: fiat (deprecated), crypto";
    expect(diagnoseFundUsdcArgv(['fund', 'usdc', '--address', ADDRESS, 'bogus'])).toBe(message);
    // Known switches take no value, so what follows them is still an operand.
    expect(diagnoseFundUsdcArgv(['fund', 'usdc', '--json', 'bogus'])).toBe(message);
    expect(diagnoseFundUsdcArgv(['fund', 'usdc', '--eip-7702', 'bogus'])).toBe(message);
    expect(diagnoseFundUsdcArgv(['fund', 'usdc', '--bogus=1', 'bogus'])).toBe(message);
  });
});
