import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeMultiSigSigners, deriveMultiSigAddress, fromFastAddress, Signer, toFastAddress } from '@fastxyz/sdk';
import Db from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { multisigVote } from '../../src/commands/multisig/vote.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { resolveSigner } from '../../src/services/signer-resolver.js';
import { AccountStore } from '../../src/services/storage/account.js';
import { DatabaseService } from '../../src/services/storage/database.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const seed = (value: number) => new Uint8Array(32).fill(value);

describe('multisig vote handler', () => {
  it('shows the exact transaction before the real confirmation and submission', async () => {
    const sqlite = new Db(join(mkdtempSync(join(tmpdir(), 'fast-vote-handler-')), 'fast.db'));
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
    const dbLayer = Layer.succeed(DatabaseService, {
      query: <A>(fn: (database: typeof db) => A) => Effect.sync(() => fn(db)),
    } as never);
    const accountsLayer = AccountStore.Default.pipe(Layer.provide(dbLayer));
    const lines: string[] = [];
    let submitted = 0;
    let confirmedAfterDetails = false;

    const baseLayers = Layer.mergeAll(
      dbLayer,
      accountsLayer,
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: false,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(NetworkConfigService, {
        resolve: () => Effect.succeed(bundledNetworks.testnet!),
      } as never),
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
        ok: () => Effect.void,
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      } as never),
      Layer.succeed(Prompt, {
        password: () => Effect.die('password prompt must not run'),
        input: () => Effect.die('input prompt must not run'),
        confirm: () =>
          Effect.sync(() => {
            const output = lines.join('\n');
            confirmedAfterDetails =
              output.includes('[1] TokenTransfer') &&
              output.includes('"amount": "100000"') &&
              output.includes('fast:testnet') &&
              output.includes('Operations: 1');
            return true;
          }),
      } as never),
      Layer.succeed(HistoryStore, { record: () => Effect.void } as never),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create('alice', seed(1), null);
        yield* accounts.create('bob', seed(2), null);
        yield* accounts.create('carol', seed(3), null);
        const singles = yield* accounts.list();
        const signerAddresses = canonicalizeMultiSigSigners(singles.map((account) => fromFastAddress(account.fastAddress))).map(toFastAddress);
        const config = {
          authorized_signers: signerAddresses.map(fromFastAddress),
          quorum: 2n,
          nonce: 0n,
        };
        const fastAddress = yield* Effect.promise(() => deriveMultiSigAddress(config));
        yield* accounts.createMultiSig(
          {
            version: 1,
            name: 'treasury',
            signers: signerAddresses,
            quorum: 2,
            configNonce: '0',
            fastAddress,
            network: 'testnet',
          },
          true,
        );
        const treasury = yield* accounts.get('treasury');
        const alice = yield* resolveSigner({
          account: treasury,
          asMember: 'alice',
          network: 'testnet',
          password: null,
        });
        if (alice.kind !== 'multisig') throw new Error('expected multisig signer');
        const recipient = yield* Effect.promise(() => new Signer(seed(9)).getPublicKey());
        const envelope = yield* Effect.promise(() =>
          alice.signer.signTransaction({
            networkId: 'fast:testnet',
            nonce: 0n,
            operations: [
              {
                type: 'TokenTransfer',
                value: {
                  tokenId: new Uint8Array(32).fill(0xd7),
                  recipient,
                  amount: 100000n,
                  userData: null,
                },
              },
            ],
          }),
        );

        const rpcLayer = Layer.succeed(FastRpc, {
          getPendingMultisigTransactions: () => Effect.succeed([envelope]),
          getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
          getTokenInfo: () =>
            Effect.succeed({
              requestedTokenMetadata: [[new Uint8Array(32).fill(0xd7), { tokenName: 'TEST', decimals: 6 }]],
            }),
          submitTransaction: () =>
            Effect.sync(() => {
              submitted++;
              return { type: 'IncompleteMultiSig' };
            }),
        } as never);

        yield* multisigVote.handler({ asMember: 'bob', yes: false } as never).pipe(Effect.provide(Layer.merge(baseLayers, rpcLayer)));
      }).pipe(Effect.provide(baseLayers)),
    );

    expect(confirmedAfterDetails).toBe(true);
    expect(submitted).toBe(1);
  });
});
