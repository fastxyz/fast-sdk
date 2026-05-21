import { describe, expect, it } from 'vitest';
import { Effect, Layer, Ref } from 'effect';
import Db from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deriveMultiSigAddress, fromFastAddress } from '@fastxyz/sdk';
import { AccountStore } from '../../src/services/storage/account';
import { DatabaseService } from '../../src/services/storage/database';
import { resolveSigner } from '../../src/services/signer-resolver';
import { submitOperation } from '../../src/services/tx-pipeline';
import { FastRpc } from '../../src/services/api/fast';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SEED = (b: number) => new Uint8Array(32).fill(b);

interface RpcState {
  submittedSuccess: number;
}

const makeDbLayer = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fast-cli-token-test-'));
  const dbPath = join(dir, 'fast.db');
  const sqlite = new Db(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
  return Layer.succeed(DatabaseService, {
    query: <A>(fn: (db: typeof db) => A, _msg: string) => Effect.sync(() => fn(db)),
  } as never);
};

const makeRpcLayer = (state: Ref.Ref<RpcState>, multisigQuorum = 1) =>
  Layer.succeed(FastRpc, {
    getAccountInfo: (_p: unknown) => Effect.succeed({ nextNonce: 0n }) as never,
    getTokenInfo: (_p: unknown) =>
      Effect.succeed({
        requestedTokenMetadata: [
          [
            new Uint8Array(32).fill(0xee),
            {
              updateId: 0n,
              decimals: 6,
              admin: new Uint8Array(32),
              tokenName: 'TEST',
              totalSupply: 0n,
              mints: [],
            },
          ],
        ],
      }) as never,
    submitTransaction: (envelope: unknown) =>
      Effect.gen(function* () {
        const env = envelope as { signature: { type: string } };
        if (env.signature.type === 'Signature') {
          yield* Ref.update(state, (s) => ({
            submittedSuccess: s.submittedSuccess + 1,
          }));
          return { type: 'Success', certificate: { stub: true } } as never;
        }
        // MultiSig
        if (multisigQuorum > 1) {
          return { type: 'IncompleteMultiSig' } as never;
        }
        yield* Ref.update(state, (s) => ({
          submittedSuccess: s.submittedSuccess + 1,
        }));
        return { type: 'Success', certificate: { stub: true } } as never;
      }) as never,
    getPendingMultisigTransactions: (_p: unknown) => Effect.succeed([]) as never,
    getTransactionCertificates: (_p: unknown) => Effect.succeed([]) as never,
    getRpcUrl: () => Effect.succeed('http://test'),
  } as unknown as never);

const makeFullLayer = (state: Ref.Ref<RpcState>, multisigQuorum = 1) => {
  const dbLayer = makeDbLayer();
  const accountsLayer = AccountStore.Default.pipe(Layer.provide(dbLayer));
  return Layer.mergeAll(dbLayer, accountsLayer, makeRpcLayer(state, multisigQuorum));
};

describe('token operations end-to-end (service-level)', () => {
  it('single-signer create → submitOperation returns Success', async () => {
    const stateRef = await Effect.runPromise(Ref.make<RpcState>({ submittedSuccess: 0 }));
    const layer = makeFullLayer(stateRef, 1);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create('alice', SEED(0xaa), null);
        const alice = yield* accounts.get('alice');
        const resolved = yield* resolveSigner({
          account: alice,
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: 'fast:testnet',
          operation: {
            type: 'TokenCreation',
            value: {
              tokenName: 'TEST',
              decimals: 6,
              initialAmount: 1000000n,
              mints: [],
              userData: null,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe('success');
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const final = await Effect.runPromise(Ref.get(stateRef));
    expect(final.submittedSuccess).toBe(1);
  });

  it('multisig (quorum=2) mint → submitOperation returns incomplete-multisig', async () => {
    const stateRef = await Effect.runPromise(Ref.make<RpcState>({ submittedSuccess: 0 }));
    const layer = makeFullLayer(stateRef, 2);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create('alice', SEED(0xaa), null);
        yield* accounts.create('bob', SEED(0xbb), null);
        const aliceFast = (yield* accounts.get('alice')).fastAddress;
        const bobFast = (yield* accounts.get('bob')).fastAddress;
        const sortedSigners = [aliceFast, bobFast].sort();
        const fastAddress = yield* Effect.promise(() =>
          deriveMultiSigAddress({
            authorized_signers: sortedSigners.map((s) => fromFastAddress(s)),
            quorum: 2n,
            nonce: 0n,
          }),
        );
        yield* accounts.createMultiSig(
          {
            version: 1,
            name: 'treasury',
            signers: sortedSigners,
            quorum: 2,
            configNonce: '0',
            fastAddress,
            network: 'testnet',
          },
          true,
        );
        const treasury = yield* accounts.get('treasury');
        const resolved = yield* resolveSigner({
          account: treasury,
          asMember: 'alice',
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: 'fast:testnet',
          operation: {
            type: 'Mint',
            value: {
              tokenId: new Uint8Array(32).fill(0xee),
              recipient: new Uint8Array(32).fill(0xff),
              amount: 100n,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe('incomplete-multisig');
    expect(result.txHash).toBeNull();
  });

  it('burn op routes through pipeline (single-signer)', async () => {
    const stateRef = await Effect.runPromise(Ref.make<RpcState>({ submittedSuccess: 0 }));
    const layer = makeFullLayer(stateRef, 1);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create('alice', SEED(0xaa), null);
        const alice = yield* accounts.get('alice');
        const resolved = yield* resolveSigner({
          account: alice,
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: 'fast:testnet',
          operation: {
            type: 'Burn',
            value: {
              tokenId: new Uint8Array(32).fill(0xee),
              amount: 50n,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe('success');
  });

  it('manage op routes through pipeline (single-signer)', async () => {
    const stateRef = await Effect.runPromise(Ref.make<RpcState>({ submittedSuccess: 0 }));
    const layer = makeFullLayer(stateRef, 1);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const accounts = yield* AccountStore;
        yield* accounts.create('alice', SEED(0xaa), null);
        const alice = yield* accounts.get('alice');
        const resolved = yield* resolveSigner({
          account: alice,
          password: null,
        });
        return yield* submitOperation({
          resolved,
          networkId: 'fast:testnet',
          operation: {
            type: 'TokenManagement',
            value: {
              tokenId: new Uint8Array(32).fill(0xee),
              updateId: 1n,
              newAdmin: null,
              mints: [],
              userData: null,
            } as never,
          },
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe('success');
  });
});
