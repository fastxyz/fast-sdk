/**
 * Token-command metadata used only when Optique cannot produce a complete
 * diagnostic. Keep it aligned with the parsers in cli.ts so fallback errors
 * never misclassify a valid option as unknown.
 */
export const TOKEN_COMMAND_FALLBACKS = {
  create: {
    usage: 'fast token create --name <s> --decimals <n> --initial-supply <amt> [--minters <addr,...>] [--memo <s>] [--as <name>] [--replace-pending]',
    options: ['--name', '--decimals', '--initial-supply', '--minters', '--memo', '--as', '--replace-pending'],
  },
  mint: {
    usage: 'fast token mint --token <id|name> --to <addr> --amount <n> [--as <name>] [--replace-pending]',
    options: ['--token', '--to', '--amount', '--as', '--replace-pending'],
  },
  burn: {
    usage: 'fast token burn --token <id|name> --amount <n> [--as <name>] [--replace-pending]',
    options: ['--token', '--amount', '--as', '--replace-pending'],
  },
  manage: {
    usage:
      'fast token manage --token <id|name> [--admin <addr>] [--add-minters <addr,...>] [--remove-minters <addr,...>] [--memo <s>] [--as <name>] [--replace-pending]',
    options: ['--token', '--admin', '--add-minters', '--remove-minters', '--memo', '--as', '--replace-pending'],
  },
} as const;
