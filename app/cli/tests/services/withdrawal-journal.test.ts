import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withWithdrawalJournal } from '../../src/services/storage/withdrawal-journal.js';

const dirs: string[] = [];
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), 'withdrawal-test-'));
  dirs.push(dir);
  return join(dir, 'withdrawal.json');
};
afterEach(() => {
  vi.restoreAllMocks();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
describe('private withdrawal journal', () => {
  it('rejects a FIFO without blocking, running the coordinator or leaving a lock', () => {
    const path = file();
    execFileSync('mkfifo', ['-m', '600', path]);
    const module = new URL('../../src/services/storage/withdrawal-journal.ts', import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { withWithdrawalJournal } from ${JSON.stringify(module)};
      await assert.rejects(
        withWithdrawalJournal(process.argv[1], async () => assert.fail('coordinator must not run')),
        /withdrawal journal must be a private, owned regular file/,
      );
    `,
        path,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(statSync(path).isFIFO()).toBe(true);
    expect(existsSync(`${path}.lock`)).toBe(false);
  }, 10000);
  it('rejects Windows explicitly before opening a journal or running the coordinator', async () => {
    const path = file();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const run = vi.fn();
    await expect(withWithdrawalJournal(path, run)).rejects.toThrow('Multisig withdrawal journals currently support macOS and Linux only');
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });
  it.each(['null', '[]', '"unexpected"'])('does not treat existing %s as a new withdrawal', async (content) => {
    const path = file();
    writeFileSync(path, content, { mode: 0o600 });
    await expect(
      withWithdrawalJournal(path, async () => {
        throw new Error('must not run');
      }),
    ).rejects.toThrow('invalid withdrawal journal root');
    expect(readFileSync(path, 'utf8')).toBe(content);
  });
  it('durably round-trips public recovery data in a private file', async () => {
    const path = file();
    await withWithdrawalJournal(path, async (store) => {
      expect(store.read()).toBeNull();
      store.write({ version: 1 } as never);
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await withWithdrawalJournal(path, async (store) => expect(store.read()).toEqual({ version: 1 }));
  });
  it('refuses a concurrent coordinator', async () => {
    const path = file();
    await withWithdrawalJournal(path, async () => {
      await expect(withWithdrawalJournal(path, async () => {})).rejects.toThrow('locked');
    });
    await expect(withWithdrawalJournal(path, async () => {})).resolves.toBeUndefined();
  });
  it('refuses symlink and readable-by-others journals without touching their target', async () => {
    const path = file(),
      target = file();
    writeFileSync(target, 'secret', { mode: 0o600 });
    symlinkSync(target, path);
    await expect(withWithdrawalJournal(path, async (s) => s.read())).rejects.toThrow();
    expect(readFileSync(target, 'utf8')).toBe('secret');
    const unsafe = file();
    writeFileSync(unsafe, '{}', { mode: 0o644 });
    await expect(withWithdrawalJournal(unsafe, async (s) => s.read())).rejects.toThrow('private');
  });
});
