/**
 * Raw argv tokenization for diagnosing command lines the parser rejected.
 *
 * The parser's own error ("No matching option or argument found.") rarely names
 * the real mistake, so main.ts looks at argv itself to find the command and its
 * operands. To do that it must skip option values, or `fast --network mainnet
 * request` would read `mainnet` as the command.
 */

/** Global options that take the next argument as their value (`--network mainnet`). */
export const GLOBAL_VALUE_FLAGS = ['--network', '--account', '--password'] as const;

/** An argument shaped like a negative number (`-5`, `-0.5`, `-.5`). */
const NEGATIVE_NUMBER = /^-\.?\d/;

export interface ArgvTokens {
  /** The command path and its operands, in order, with option values left out. */
  readonly operands: readonly string[];
  /**
   * Negative numbers standing where an operand would. The parser reads some of
   * them (`-5`) as unknown options, so they never reach a command's own amount
   * validation.
   */
  readonly negativeNumbers: readonly string[];
}

/**
 * Split argv into operands and operand-position negative numbers. A value-taking
 * option consumes the next argument whatever it looks like, as the parser does
 * (`--timeout -3` is the timeout, not an operand); `--flag=value` is a single
 * argument. `valueFlags` adds a command's own value-taking options to the global
 * ones.
 */
export const tokenizeArgv = (argv: readonly string[], valueFlags: readonly string[] = []): ArgvTokens => {
  const takesValue = new Set<string>([...GLOBAL_VALUE_FLAGS, ...valueFlags]);
  const operands: string[] = [];
  const negativeNumbers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (takesValue.has(arg)) {
      i++; // its value
    } else if (NEGATIVE_NUMBER.test(arg)) {
      negativeNumbers.push(arg);
    } else if (!arg.startsWith('-')) {
      operands.push(arg);
    }
  }
  return { operands, negativeNumbers };
};
