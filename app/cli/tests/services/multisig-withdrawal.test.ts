import { describe, expect, it, vi } from 'vitest';
import { canonicalizeMultiSigSigners, MultiSigSigner, Signer } from '@fastxyz/sdk';
import { verifyTypedData } from '@fastxyz/sdk/core';
import { bcsSchema, VersionedTransactionFromBcs, type TransactionEnvelope } from '@fastxyz/schema';
import { Effect, Schema } from 'effect';
import { runMultisigWithdrawal, type WithdrawalRoute } from '../../src/services/multisig-withdrawal.js';

const route: WithdrawalRoute = {
  networkId: 'fast:testnet',
  sender: '',
  chainId: 421614,
  amount: '1000000',
  fastBridgeAddress: '',
  tokenFastTokenId: `0x${'01'.repeat(32)}`,
  tokenEvmAddress: `0x${'02'.repeat(20)}`,
  receiver: `0x${'03'.repeat(20)}`,
  bridgeContract: `0x${'04'.repeat(20)}`,
  evmRpcUrl: 'https://rpc.example',
  crossSignUrl: 'https://cross.example',
  relayerUrl: 'https://relay.example',
};
async function setup() {
  const keys = [1, 2, 3].map((x) => new Uint8Array(32).fill(x));
  const singles = keys.map((x) => new Signer(x));
  const config = {
    authorized_signers: canonicalizeMultiSigSigners(await Promise.all(singles.map((x) => x.getPublicKey()))),
    quorum: 2n,
    nonce: 1n,
  };
  const signer = new MultiSigSigner({ config, secretKey: keys[0]! });
  const cosigner = new MultiSigSigner({ config, secretKey: keys[1]! });
  const r = { ...route, sender: await signer.getFastAddress(), fastBridgeAddress: await singles[2]!.getFastAddress() };
  let saved: unknown = null;
  const store = {
    read: () => structuredClone(saved),
    write: vi.fn((x: unknown) => {
      saved = structuredClone(x);
    }),
  };
  const certs: unknown[] = [],
    pending: unknown[] = [];
  let nonce = 0n;
  const provider = {
    getAccountInfo: vi.fn(async (_params?: { tokenBalancesFilter: readonly Uint8Array[] | null }) => ({
      nextNonce: nonce,
      pendingConfirmation: null,
      tokenBalance: [[new Uint8Array(32).fill(1), 10000000n]],
    })),
    getPendingMultisigTransactions: vi.fn(async () => pending),
    getTransactionCertificates: vi.fn(async () => certs),
    submitTransaction: vi.fn(async (e: unknown) => {
      pending.push(e);
      return { type: 'IncompleteMultiSig' };
    }),
  };
  const crossSign = vi.fn(async (c: any) => {
    const { prepareSubmissionRecovery } = await import('../../src/services/tx-pipeline.js');
    const { Effect } = await import('effect');
    const { txHash } = await Effect.runPromise(prepareSubmissionRecovery(c.envelope));
    return { transaction: [...new Uint8Array(32), ...Buffer.from(txHash.replace(/^0x/, ''), 'hex')], signature: '0x11' };
  });
  const deps = {
    provider: provider as never,
    crossSign,
    relay: vi.fn(async () => ({ success: true as const })),
    simulate: vi.fn(async () => {}),
    getEvmBlock: vi.fn(async () => 10n),
    settlement: vi.fn(async () => false),
    now: () => 1000,
  };
  const run = () => runMultisigWithdrawal(r, signer, store, deps);
  const confirm = () => {
    const e = pending.shift();
    certs.push({ envelope: e });
    nonce++;
  };
  return {
    r,
    signer,
    cosigner,
    store,
    deps,
    provider,
    run,
    confirm,
    pending,
    certs,
    get saved() {
      return saved as any;
    },
  };
}
describe('resumable AllSet multisig withdrawal', () => {
  it('requests the withdrawal token balance when resuming a preflight-only journal', async () => {
    const s = await setup();
    const tokenId = new Uint8Array(32).fill(1);
    s.store.write({ version: 1, route: s.r, evmStartBlock: '10' });
    s.provider.getAccountInfo.mockImplementation(async (params) => ({
      nextNonce: 0n,
      pendingConfirmation: null,
      // The REST API omits token balances when no filter is supplied.
      tokenBalance: params?.tokenBalancesFilter?.some((id) => Buffer.from(id).equals(tokenId)) ? [[tokenId, 10000000n]] : [],
    }));
    expect((await s.run()).status).toBe('awaiting-transfer-signatures');
    expect(s.provider.getAccountInfo).toHaveBeenCalledWith({
      address: s.r.sender,
      tokenBalancesFilter: [tokenId],
      stateKeyFilter: null,
    });
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
  it.each([null, false, 0, ''])('rejects a malformed saved transfer %s instead of paying again', async (transfer) => {
    const s = await setup();
    await s.run();
    s.confirm();
    s.store.write({ ...s.saved, transfer });
    await expect(s.run()).rejects.toThrow('invalid saved transfer');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
  it('uses two independent cryptographic signers on each exact transfer and intent payload', async () => {
    const s = await setup();
    await s.run();
    for (const stage of ['transfer', 'intent']) {
      const first = s.pending[0] as TransactionEnvelope;
      const second = await s.cosigner.signEnvelopeFor(first.transaction);
      expect(second.transaction).toEqual(first.transaction);
      expect(first.signature.type).toBe('MultiSig');
      expect(second.signature.type).toBe('MultiSig');
      if (first.signature.type !== 'MultiSig' || second.signature.type !== 'MultiSig') throw new Error('wrong envelope');
      const signatures = [...first.signature.value.signatures, ...second.signature.value.signatures];
      expect(new Set(signatures.map(([key]) => Buffer.from(key).toString('hex'))).size).toBe(2);
      const encoded = Schema.encodeSync(VersionedTransactionFromBcs)(first.transaction);
      for (const [key, signature] of signatures)
        expect(await Effect.runPromise(verifyTypedData(signature, bcsSchema.VersionedTransaction, encoded, key))).toBe(true);
      s.confirm();
      expect((await s.run()).status).toBe(stage === 'transfer' ? 'awaiting-intent-signatures' : 'awaiting-settlement');
    }
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
    expect(s.deps.relay).toHaveBeenCalledTimes(1);
  });
  it('keeps an externally recovered withdrawal terminal even without a locally saved intent', async () => {
    const s = await setup();
    await s.run();
    s.deps.settlement.mockResolvedValue(true);
    expect((await s.run()).status).toBe('completed');
    expect((await s.run()).status).toBe('completed');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
  it('persists a transfer before submission and waits for quorum', async () => {
    const s = await setup();
    s.provider.submitTransaction.mockImplementationOnce(async (e) => {
      expect(s.saved.transfer.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(s.saved.transfer.envelope).toBeDefined();
      s.pending.push(e);
      return { type: 'IncompleteMultiSig' };
    });
    expect((await s.run()).status).toBe('awaiting-transfer-signatures');
    expect((await s.run()).status).toBe('awaiting-transfer-signatures');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
  it('proposes only the intent after transfer confirmation; relay acceptance is not settlement', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    expect((await s.run()).status).toBe('awaiting-intent-signatures');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
    s.confirm();
    expect((await s.run()).status).toBe('awaiting-settlement');
    expect((await s.run()).status).toBe('awaiting-settlement');
    expect(s.deps.relay).toHaveBeenCalledTimes(1);
    s.deps.settlement.mockResolvedValue(true);
    expect((await s.run()).status).toBe('completed');
    expect((await s.run()).status).toBe('completed');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it('does not repeat a transfer after a lost response and reload', async () => {
    const s = await setup();
    s.provider.submitTransaction.mockRejectedValueOnce(new Error('lost response'));
    await expect(s.run()).rejects.toThrow('lost response');
    expect((await s.run()).status).toBe('transfer-uncertain');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
  it('does not repeat a relay after a lost response', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.confirm();
    s.deps.relay.mockRejectedValueOnce(new Error('lost relay response'));
    await expect(s.run()).rejects.toThrow('lost relay response');
    expect((await s.run()).status).toBe('relay-uncertain');
    expect(s.deps.relay).toHaveBeenCalledTimes(1);
  });
  it('fails before any submission if storage fails', async () => {
    const s = await setup();
    s.store.write.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(s.run()).rejects.toThrow('disk full');
    expect(s.provider.submitTransaction).not.toHaveBeenCalled();
  });
  it('fails before signing/submitting if the attempt cannot be saved', async () => {
    const s = await setup();
    s.store.write
      .mockImplementationOnce((x) => {})
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      });
    await expect(s.run()).rejects.toThrow('disk full');
    expect(s.provider.submitTransaction).not.toHaveBeenCalled();
  });
  it('refuses insufficient Fast token balance before payment', async () => {
    const s = await setup();
    s.provider.getAccountInfo.mockResolvedValueOnce({ nextNonce: 0n, pendingConfirmation: null, tokenBalance: [] });
    await expect(s.run()).rejects.toThrow('balance');
    expect(s.provider.submitTransaction).not.toHaveBeenCalled();
  });
  it('refuses a requested token balance below the withdrawal amount', async () => {
    const s = await setup();
    s.provider.getAccountInfo.mockResolvedValueOnce({
      nextNonce: 0n,
      pendingConfirmation: null,
      tokenBalance: [[new Uint8Array(32).fill(1), 999999n]],
    });
    await expect(s.run()).rejects.toThrow('insufficient Fast token balance');
    expect(s.provider.submitTransaction).not.toHaveBeenCalled();
  });
  it('never repeats an intent after a lost response', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    s.provider.submitTransaction.mockRejectedValueOnce(new Error('lost intent response'));
    await expect(s.run()).rejects.toThrow('lost intent response');
    expect((await s.run()).status).toBe('intent-uncertain');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it('blocks relay when cross-sign returns another transaction identity', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.confirm();
    s.deps.crossSign.mockResolvedValueOnce({ transaction: new Array(64).fill(0), signature: '0x11' });
    await expect(s.run()).rejects.toThrow('cross-sign identity');
    expect(s.deps.relay).not.toHaveBeenCalled();
  });
  it('does not reopen a completed journal when EVM evidence is temporarily absent', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.confirm();
    await s.run();
    s.deps.settlement.mockResolvedValueOnce(true);
    await s.run();
    expect((await s.run()).status).toBe('settlement-unavailable');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
    expect(s.deps.relay).toHaveBeenCalledTimes(1);
  });
  it('blocks expired intents without rebuilding or relaying', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.confirm();
    s.deps.now = () => 1000000;
    await expect(s.run()).rejects.toThrow('expired');
    expect(s.deps.relay).not.toHaveBeenCalled();
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it('does not request another signature for an expired pending intent', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.deps.now = () => 1000000;
    await expect(s.run()).rejects.toThrow('expired');
    expect(s.deps.relay).not.toHaveBeenCalled();
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it('does not relay if destination simulation fails', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.confirm();
    s.deps.simulate.mockRejectedValueOnce(new Error('simulation reverted'));
    await expect(s.run()).rejects.toThrow('simulation reverted');
    expect(s.deps.relay).not.toHaveBeenCalled();
  });
  it('refuses a changed recipient on resume', async () => {
    const s = await setup();
    await s.run();
    await expect(runMultisigWithdrawal({ ...s.r, receiver: `0x${'05'.repeat(20)}` }, s.signer, s.store, s.deps)).rejects.toThrow('route');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['networkId', 'fast:mainnet'],
    ['sender', 'different-sender'],
    ['chainId', 1],
    ['amount', '2000000'],
    ['fastBridgeAddress', 'use-sender'],
    ['tokenFastTokenId', `0x${'05'.repeat(32)}`],
    ['tokenEvmAddress', `0x${'05'.repeat(20)}`],
    ['bridgeContract', `0x${'05'.repeat(20)}`],
  ])('still rejects a changed %s when endpoints rotate', async (field, value) => {
    const s = await setup();
    await s.run();
    const changed = { ...s.r, evmRpcUrl: 'https://new-rpc.example', [field]: value === 'use-sender' ? s.r.sender : value };
    await expect(runMultisigWithdrawal(changed, s.signer, s.store, s.deps)).rejects.toThrow();
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
    expect(s.deps.relay).not.toHaveBeenCalled();
  });
  it('recovers a paid transfer with rotated endpoints without replacing its signed identity', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    const original = structuredClone(s.saved.transfer);
    const rotated = {
      ...s.r,
      evmRpcUrl: 'https://new-rpc.example',
      crossSignUrl: 'https://new-cross.example',
      relayerUrl: 'https://new-relay.example',
    };
    expect((await runMultisigWithdrawal(rotated, s.signer, s.store, s.deps)).status).toBe('awaiting-intent-signatures');
    s.confirm();
    expect((await runMultisigWithdrawal(rotated, s.signer, s.store, s.deps)).status).toBe('awaiting-settlement');
    expect(s.saved.transfer).toEqual(original);
    expect(s.deps.crossSign).toHaveBeenCalledWith(expect.anything(), rotated.crossSignUrl);
    expect(s.deps.relay).toHaveBeenCalledWith(expect.objectContaining({ relayerUrl: rotated.relayerUrl }));
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it('does not retry an uncertain relay after endpoint rotation', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    await s.run();
    s.confirm();
    s.deps.relay.mockRejectedValueOnce(new Error('lost response'));
    await expect(s.run()).rejects.toThrow('lost response');
    const rotated = { ...s.r, relayerUrl: 'https://new-relay.example' };
    expect((await runMultisigWithdrawal(rotated, s.signer, s.store, s.deps)).status).toBe('relay-uncertain');
    expect(s.deps.relay).toHaveBeenCalledTimes(1);
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(2);
  });
  it('refuses a different certificate occupying the saved nonce', async () => {
    const s = await setup();
    await s.run();
    s.confirm();
    s.certs[0].envelope.transaction.value.timestampNanos++;
    await expect(s.run()).rejects.toThrow('certificate');
    expect(s.provider.submitTransaction).toHaveBeenCalledTimes(1);
  });
});
