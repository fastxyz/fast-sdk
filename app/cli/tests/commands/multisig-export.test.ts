import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { multisigExport } from '../../src/commands/multisig/export.js';
import { Output } from '../../src/services/output.js';
import { AccountStore } from '../../src/services/storage/account.js';

describe('multisig export handler', () => {
  it('refuses to overwrite an existing file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fast-export-')), 'wallet.json');
    writeFileSync(path, 'sentinel');
    const layers = Layer.mergeAll(
      Layer.succeed(AccountStore, {
        get: () =>
          Effect.succeed({
            kind: 'multisig',
            name: 'treasury',
            multisigConfig: {
              version: 1,
              name: 'treasury',
              signers: ['fast1a', 'fast1b'],
              quorum: 2,
              configNonce: '0',
              fastAddress: 'fast1multisig',
              network: 'testnet',
            },
          }),
      } as never),
      Layer.succeed(Output, {
        humanLine: () => Effect.void,
        ok: () => Effect.void,
      } as never),
    );

    const exit = await Effect.runPromiseExit(
      multisigExport.handler({ name: 'treasury', out: path }).pipe(Effect.provide(layers)),
    );

    expect(exit._tag).toBe('Failure');
    expect(readFileSync(path, 'utf8')).toBe('sentinel');
  });
});
