import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanDist } from '../../scripts/clean-dist-lib.mjs';

describe('package dist cleaner', () => {
  it('removes a real dist tree including stale artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fast-sdk-clean-'));
    const dist = join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'stale-secret.txt'), 'must not ship');

    await cleanDist(pathToFileURL(dist));

    expect(existsSync(dist)).toBe(false);
  });

  it('refuses a symlinked dist and leaves the external sentinel intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fast-sdk-clean-link-'));
    const external = join(root, 'external');
    const dist = join(root, 'dist');
    mkdirSync(external);
    const sentinel = join(external, 'sentinel.txt');
    writeFileSync(sentinel, 'preserve me');
    symlinkSync(external, dist, 'dir');

    await expect(cleanDist(pathToFileURL(dist))).rejects.toThrow(/symlinked dist/);
    expect(readFileSync(sentinel, 'utf8')).toBe('preserve me');
  });
});
