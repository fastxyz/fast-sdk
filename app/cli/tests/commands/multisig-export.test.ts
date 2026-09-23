import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { multisigExport } from '../../src/commands/multisig/export.js';
import { Output } from '../../src/services/output.js';
import { AccountStore } from '../../src/services/storage/account.js';

const walletConfig = {
  version: 1 as const,
  name: 'treasury',
  signers: ['fast1a', 'fast1b'],
  quorum: 2,
  configNonce: '0',
  fastAddress: 'fast1multisig',
  network: 'testnet',
};

const exportLayers = () =>
  Layer.mergeAll(
    Layer.succeed(AccountStore, {
      get: () =>
        Effect.succeed({
          kind: 'multisig',
          name: 'treasury',
          multisigConfig: walletConfig,
        }),
    } as never),
    Layer.succeed(Output, {
      humanLine: () => Effect.void,
      ok: () => Effect.void,
    } as never),
  );

describe('multisig export handler', () => {
  it('refuses to overwrite an existing file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fast-export-')), 'wallet.json');
    writeFileSync(path, 'sentinel');

    const exit = await Effect.runPromiseExit(
      multisigExport.handler({ name: 'treasury', out: path }).pipe(
        Effect.provide(exportLayers()),
      ),
    );

    expect(exit._tag).toBe('Failure');
    expect(readFileSync(path, 'utf8')).toBe('sentinel');
  });

  const itPosix = process.platform === 'win32' ? it.skip : it;

  itPosix('creates a valid wallet export with owner-only permissions', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fast-export-')), 'wallet.json');

    await Effect.runPromise(
      multisigExport.handler({ name: 'treasury', out: path }).pipe(
        Effect.provide(exportLayers()),
      ),
    );

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(walletConfig);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
