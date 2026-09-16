import { Signer, canonicalizeMultiSigSigners, deriveMultiSigAddress, fromFastAddress, toFastAddress } from '@fastxyz/sdk';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { tokenBurn } from '../../src/commands/token/burn.js';
import { tokenCreate } from '../../src/commands/token/create.js';
import { tokenManage } from '../../src/commands/token/manage.js';
import { tokenMint } from '../../src/commands/token/mint.js';
import { bundledNetworks } from '../../src/config/networks.js';
import { DatabaseError } from '../../src/errors/index.js';
import { FastRpc } from '../../src/services/api/fast.js';
import { ClientConfig } from '../../src/services/config/client.js';
import { Output } from '../../src/services/output.js';
import { Prompt } from '../../src/services/prompt.js';
import { AccountStore, type AccountInfo } from '../../src/services/storage/account.js';
import { HistoryStore } from '../../src/services/storage/history.js';
import { NetworkConfigService } from '../../src/services/storage/network.js';

const seed = (value: number) => new Uint8Array(32).fill(value);
const tokenId = new Uint8Array(32).fill(0xee);
const tokenHex = `0x${'ee'.repeat(32)}`;
const nativeTokenHex = `0xfa575e70${'00'.repeat(28)}`;

const makeBaseLayer = async ({ historyFailure = false }: { readonly historyFailure?: boolean } = {}) => {
  const accountSeed = seed(1);
  const signer = new Signer(accountSeed);
  const fastAddress = await signer.getFastAddress();
  const account: AccountInfo = {
    kind: 'single',
    name: 'alice',
    fastAddress,
    evmAddress: '0x0000000000000000000000000000000000000000',
    isDefault: true,
    encrypted: false,
    createdAt: new Date(0).toISOString(),
  };
  const lines: string[] = [];
  const results: unknown[] = [];

  return {
    account,
    layer: Layer.mergeAll(
      Layer.succeed(AccountStore, {
        resolveAccount: () => Effect.succeed(account),
        export: () => Effect.succeed({ seed: accountSeed, account }),
        list: () => Effect.succeed([account]),
      } as never),
      Layer.succeed(ClientConfig, {
        json: false,
        debug: false,
        nonInteractive: true,
        network: 'testnet',
        account: Option.none(),
        password: Option.none(),
      }),
      Layer.succeed(NetworkConfigService, {
        resolve: () => Effect.succeed(bundledNetworks.testnet!),
      } as never),
      Layer.succeed(Output, {
        humanLine: (line: string) => Effect.sync(() => void lines.push(line)),
        ok: (data: unknown) => Effect.sync(() => void results.push(data)),
        fail: () => Effect.void,
        humanTable: () => Effect.void,
        debug: () => Effect.void,
      }),
      Layer.succeed(Prompt, {
        password: () => Effect.die('password prompt must not run'),
        input: () => Effect.die('input prompt must not run'),
        confirm: () => Effect.die('confirmation must not run'),
      } as never),
      Layer.succeed(HistoryStore, {
        record: () => (historyFailure ? Effect.fail(new DatabaseError({ message: 'history database unavailable' })) : Effect.void),
      } as never),
    ),
    lines,
    results,
  };
};

const makeMultisigBaseLayer = async () => {
  const aliceSeed = seed(1);
  const bobSeed = seed(2);
  const aliceSigner = new Signer(aliceSeed);
  const bobSigner = new Signer(bobSeed);
  const aliceAddress = await aliceSigner.getFastAddress();
  const bobAddress = await bobSigner.getFastAddress();
  const signers = canonicalizeMultiSigSigners([fromFastAddress(aliceAddress), fromFastAddress(bobAddress)]).map(toFastAddress);
  const multisigAddress = await deriveMultiSigAddress({
    authorized_signers: signers.map(fromFastAddress),
    quorum: 2n,
    nonce: 0n,
  });
  const alice: AccountInfo = {
    kind: 'single',
    name: 'alice',
    fastAddress: aliceAddress,
    evmAddress: '0x0000000000000000000000000000000000000000',
    isDefault: false,
    encrypted: false,
    createdAt: new Date(0).toISOString(),
  };
  const bob: AccountInfo = {
    ...alice,
    name: 'bob',
    fastAddress: bobAddress,
  };
  const account: AccountInfo = {
    kind: 'multisig',
    name: 'treasury',
    fastAddress: multisigAddress,
    multisigConfig: {
      version: 1,
      name: 'treasury',
      signers,
      quorum: 2,
      configNonce: '0',
      fastAddress: multisigAddress,
      network: 'testnet',
    },
    isDefault: true,
    createdAt: new Date(0).toISOString(),
  };

  const singleByName = new Map([
    [alice.name, { account: alice, seed: aliceSeed }],
    [bob.name, { account: bob, seed: bobSeed }],
  ]);
  const singleBase = await makeBaseLayer();
  const accountsLayer = Layer.succeed(AccountStore, {
    resolveAccount: () => Effect.succeed(account),
    export: (name: string) => {
      const found = singleByName.get(name);
      return found ? Effect.succeed(found) : Effect.die(`unknown member ${name}`);
    },
    list: () => Effect.succeed([alice, bob, account]),
  } as never);

  return { account, layer: Layer.merge(singleBase.layer, accountsLayer) };
};

const tokenMetadata = (admin: Uint8Array, mints: readonly Uint8Array[], updateId = 9n) => ({
  requestedTokenMetadata: [
    [
      tokenId,
      {
        updateId,
        decimals: 6,
        admin,
        tokenName: 'TEST',
        totalSupply: 0n,
        mints,
      },
    ],
  ],
});

describe('token authority handlers', () => {
  it('token mint rejects an account absent from the on-chain minter set', async () => {
    const { account, layer } = await makeBaseLayer();
    let submissions = 0;
    const rpcLayer = Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.succeed(tokenMetadata(new Uint8Array(32), [seed(9)])),
      submitTransaction: () =>
        Effect.sync(() => {
          submissions++;
          return { type: 'Success' };
        }),
    } as never);

    await expect(
      Effect.runPromise(
        tokenMint
          .handler({
            token: tokenHex,
            to: account.fastAddress,
            amount: '1',
            replacePending: false,
          } as never)
          .pipe(Effect.provide(Layer.merge(layer, rpcLayer))),
      ),
    ).rejects.toThrow(/not an authorized minter/);
    expect(submissions).toBe(0);
  });

  it('token mint lets an authorized multisig minter reach partial submission', async () => {
    const { account, layer } = await makeMultisigBaseLayer();
    const accountBytes = fromFastAddress(account.fastAddress);
    let submitted: unknown;
    const rpcLayer = Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.succeed(tokenMetadata(new Uint8Array(32), [accountBytes])),
      getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
      getPendingMultisigTransactions: () => Effect.succeed([]),
      submitTransaction: (envelope: unknown) =>
        Effect.sync(() => {
          submitted = envelope;
          return { type: 'IncompleteMultiSig' };
        }),
    } as never);

    await Effect.runPromise(
      tokenMint
        .handler({
          token: tokenHex,
          to: account.fastAddress,
          amount: '1.25',
          asMember: 'alice',
          replacePending: false,
        } as never)
        .pipe(Effect.provide(Layer.merge(layer, rpcLayer))),
    );

    const operation = (submitted as { transaction: { value: { claims: readonly [{ type: string; value: { amount: bigint } }] } } }).transaction.value
      .claims[0];
    expect(operation.type).toBe('Mint');
    expect(operation.value.amount).toBe(1_250_000n);
  });

  it('token manage rejects the native token before metadata lookup or submission', async () => {
    const { account, layer } = await makeBaseLayer();
    let metadataCalls = 0;
    let submissions = 0;
    const rpcLayer = Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.sync(() => void metadataCalls++),
      submitTransaction: () => Effect.sync(() => void submissions++),
    } as never);

    await expect(
      Effect.runPromise(
        tokenManage
          .handler({
            token: nativeTokenHex,
            admin: account.fastAddress,
            replacePending: false,
          } as never)
          .pipe(Effect.provide(Layer.merge(layer, rpcLayer))),
      ),
    ).rejects.toThrow(/Cannot manage the native token/);
    expect(metadataCalls).toBe(0);
    expect(submissions).toBe(0);
  });

  it('token manage rejects an account that is not the current admin', async () => {
    const { account, layer } = await makeBaseLayer();
    let submissions = 0;
    const rpcLayer = Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.succeed(tokenMetadata(seed(9), [])),
      submitTransaction: () =>
        Effect.sync(() => {
          submissions++;
          return { type: 'Success' };
        }),
    } as never);

    await expect(
      Effect.runPromise(
        tokenManage
          .handler({
            token: tokenHex,
            admin: toFastAddress(seed(8)),
            replacePending: false,
          } as never)
          .pipe(Effect.provide(Layer.merge(layer, rpcLayer))),
      ),
    ).rejects.toThrow(/not the current token admin/);
    expect(submissions).toBe(0);
    expect(account.fastAddress).not.toBe(toFastAddress(seed(9)));
  });

  it('token manage rejects ambiguous minter changes before submission', async () => {
    const { account, layer } = await makeBaseLayer();
    const accountBytes = fromFastAddress(account.fastAddress);
    const changed = toFastAddress(seed(8));
    let submissions = 0;
    const rpcLayer = Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.succeed(tokenMetadata(accountBytes, [])),
      submitTransaction: () =>
        Effect.sync(() => {
          submissions++;
          return { type: 'Success' };
        }),
    } as never);

    await expect(
      Effect.runPromise(
        tokenManage
          .handler({
            token: tokenHex,
            addMinters: changed,
            removeMinters: changed,
            replacePending: false,
          } as never)
          .pipe(Effect.provide(Layer.merge(layer, rpcLayer))),
      ),
    ).rejects.toThrow(/duplicate or an address present in both add and remove/);
    expect(submissions).toBe(0);
  });

  it('token manage submits the current on-chain update id', async () => {
    const { account, layer } = await makeBaseLayer();
    const accountBytes = fromFastAddress(account.fastAddress);
    let submitted: unknown;
    const rpcLayer = Layer.succeed(FastRpc, {
      getTokenInfo: () => Effect.succeed(tokenMetadata(accountBytes, [], 42n)),
      getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
      submitTransaction: (envelope: unknown) =>
        Effect.sync(() => {
          submitted = envelope;
          return { type: 'Success' };
        }),
    } as never);

    await Effect.runPromise(
      tokenManage
        .handler({
          token: tokenHex,
          admin: toFastAddress(seed(8)),
          replacePending: false,
        } as never)
        .pipe(Effect.provide(Layer.merge(layer, rpcLayer))),
    );

    const operation = (submitted as { transaction: { value: { claims: readonly [{ type: string; value: { updateId: bigint } }] } } }).transaction
      .value.claims[0];
    expect(operation.type).toBe('TokenManagement');
    expect(operation.value.updateId).toBe(42n);
  });

  it.each(['create', 'mint', 'burn', 'manage'] as const)('token %s preserves confirmed settlement when local history fails', async (command) => {
    const { account, layer, lines, results } = await makeBaseLayer({ historyFailure: true });
    const accountBytes = fromFastAddress(account.fastAddress);
    let submissions = 0;
    const rpcLayer = Layer.succeed(FastRpc, {
      getAccountInfo: () => Effect.succeed({ nextNonce: 0n, pendingConfirmation: null }),
      getTokenInfo: () => Effect.succeed(tokenMetadata(accountBytes, [accountBytes], 42n)),
      submitTransaction: () =>
        Effect.sync(() => {
          submissions++;
          return { type: 'Success' };
        }),
    } as never);
    const handler =
      command === 'create'
        ? tokenCreate.handler({
            name: 'TEST',
            decimals: 6,
            initialSupply: '1',
            replacePending: false,
          } as never)
        : command === 'mint'
          ? tokenMint.handler({
              token: tokenHex,
              to: account.fastAddress,
              amount: '1',
              replacePending: false,
            } as never)
          : command === 'burn'
            ? tokenBurn.handler({
                token: tokenHex,
                amount: '1',
                replacePending: false,
              } as never)
            : tokenManage.handler({
                token: tokenHex,
                admin: toFastAddress(seed(8)),
                replacePending: false,
              } as never);

    const exit = await Effect.runPromiseExit(handler.pipe(Effect.provide(Layer.merge(layer, rpcLayer))));

    expect(exit._tag).toBe('Success');
    expect(submissions).toBe(1);
    expect(lines.join('\n')).toContain('confirmed, but local history could not be updated');
    expect(results).toEqual([
      expect.objectContaining({
        status: 'success',
        txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      }),
    ]);
  });
});
