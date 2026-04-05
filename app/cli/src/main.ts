import { runCommand, showUsage } from 'citty';
import { rootCommand } from './cli.js';

const rawArgs = process.argv.slice(2);
const isJson = rawArgs.includes('--json');
const isHelp = rawArgs.includes('--help') || rawArgs.includes('-h');
const isVersion = rawArgs.includes('--version') || rawArgs.includes('-v');

const main = async (): Promise<void> => {
  if (isVersion) {
    const rawMeta = rootCommand.meta;
    const meta = typeof rawMeta === 'function' ? await rawMeta() : await Promise.resolve(rawMeta);
    process.stdout.write(`${meta?.version ?? ''}\n`);
    return;
  }
  if (rawArgs.length === 0 || isHelp) {
    await showUsage(rootCommand);
    return;
  }
  await runCommand(rootCommand, { rawArgs });
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escapes from citty's colored error messages
const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

main().catch(async (err: unknown) => {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'INVALID_USAGE';
  if (isJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code, message: stripAnsi(rawMessage) } }, null, 2)}\n`,
    );
  } else {
    await showUsage(rootCommand).catch(() => {});
    process.stderr.write(`Error: ${rawMessage}\n`);
  }
  process.exit(1);
});
