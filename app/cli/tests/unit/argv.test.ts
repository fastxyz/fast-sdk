import { parse } from '@optique/core/parser';
import { describe, expect, it } from 'vitest';
import { tokenizeArgv } from '../../src/argv.js';
import { parser } from '../../src/cli.js';

describe('tokenizeArgv', () => {
  it('skips the values of global options, so the command is found after them', () => {
    // Before: a plain non-dash filter made `mainnet` the command ("Unknown command 'mainnet'").
    expect(tokenizeArgv(['--network', 'mainnet', 'request']).operands).toEqual(['request']);
    expect(tokenizeArgv(['--account', 'agent', 'info', '--password', 'pw', 'nope']).operands).toEqual(['info', 'nope']);
  });

  it('treats --flag=value and boolean flags as single arguments', () => {
    expect(tokenizeArgv(['--network=mainnet', '--json', 'info', 'balance', '--debug']).operands).toEqual(['info', 'balance']);
  });

  it('lets a value flag consume the next argument whatever it looks like, as the parser does', () => {
    const argv = ['request', '5', '--timeout', '-3', '--wait'];
    const result = parse(parser, argv);
    expect(result.success && result.value).toMatchObject({ amount: '5', timeout: -3 });
    expect(tokenizeArgv(argv, ['--timeout'])).toEqual({ operands: ['request', '5'], operandIndexes: [0, 1], negativeNumbers: [] });
  });

  it('collects negative numbers in operand position (the parser rejects `-5` as an unknown option)', () => {
    expect(parse(parser, ['request', '-5']).success).toBe(false);
    expect(tokenizeArgv(['request', '-5', '-0.5', '-.5', '--json'])).toEqual({
      operands: ['request'],
      operandIndexes: [0],
      negativeNumbers: ['-5', '-0.5', '-.5'],
    });
  });

  it('reports where each operand sits in argv', () => {
    const argv = ['--network', 'mainnet', 'fund', 'usdc', '--address', 'fast1x', 'crypto'];
    expect(tokenizeArgv(argv, ['--address'])).toMatchObject({ operands: ['fund', 'usdc', 'crypto'], operandIndexes: [2, 3, 6] });
  });

  it('only skips command option values it is told about', () => {
    expect(tokenizeArgv(['request', '--to', 'alice.smith']).operands).toEqual(['request', 'alice.smith']);
    expect(tokenizeArgv(['request', '--to', 'alice.smith'], ['--to']).operands).toEqual(['request']);
  });
});
