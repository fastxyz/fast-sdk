import assert from 'node:assert/strict';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import type { WithdrawalStore } from '../multisig-withdrawal.js';

/** Crash leaves the lock in place: reconcile existing attempts before removing it manually. */
export async function withWithdrawalJournal<T>(file: string, run: (store: WithdrawalStore) => Promise<T>): Promise<T> {
  if (process.platform === 'win32') throw new Error('Multisig withdrawal journals currently support macOS and Linux only');
  file = resolve(file);
  const directory = realpathSync(dirname(file));
  file = join(directory, basename(file));
  const parent = statSync(directory);
  assert.ok(
    parent.uid === process.getuid?.() && (parent.mode & 0o077) === 0,
    'withdrawal directory must be private (0700) and owned by you',
  );
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  } catch {
    throw new Error(`Withdrawal journal locked or inaccessible: ${lock}. Reconcile before removing a stale lock.`);
  }
  const syncDirectory = () => {
    const d = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  };
  const read = (): unknown => {
    let input: number;
    try {
      input = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const st = fstatSync(input);
      assert.ok(
        st.isFile() && st.nlink === 1 && st.uid === process.getuid?.() && (st.mode & 0o077) === 0,
        'withdrawal journal must be a private, owned regular file',
      );
      assert.ok(st.size <= 1024 * 1024, 'withdrawal journal too large');
      const parsed: unknown = JSON.parse(readFileSync(input, 'utf8'));
      assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'invalid withdrawal journal root');
      return parsed;
    } finally {
      closeSync(input);
    }
  };
  try {
    writeFileSync(fd, `${process.pid}\n`);
    fsyncSync(fd);
    syncDirectory();
    read(); // Reject unsafe existing files before allowing any replacement.
    return await run({
      read,
      write(value) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        const out = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
          writeFileSync(out, `${JSON.stringify(value)}\n`);
          fsyncSync(out);
          renameSync(temporary, file);
          syncDirectory();
        } finally {
          closeSync(out);
          try {
            unlinkSync(temporary);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      },
    });
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
