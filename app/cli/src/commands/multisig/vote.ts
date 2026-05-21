import { bcsSchema, type TransactionEnvelope, VersionedTransactionFromBcs } from '@fastxyz/schema';
import { fromFastAddress, getTokenId, hashHex, toFastAddress, toHex } from '@fastxyz/sdk';
import { Effect, Schema } from 'effect';
import type { MultisigVoteArgs } from '../../cli.js';
import { AlreadyVotedError, FastSdkError, TransactionFailedError, WalletKindMismatchError } from '../../errors/index.js';
import { makeHistoryEntry, type HistoryEntry } from '../../schemas/history.js';
import { FastRpc } from '../../services/api/fast.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { Prompt } from '../../services/prompt.js';
import { ensureMultisigNetwork, resolveSigner } from '../../services/signer-resolver.js';
import { AccountStore } from '../../services/storage/account.js';
import { HistoryStore } from '../../services/storage/history.js';
import { NetworkConfigService } from '../../services/storage/network.js';
import type { Command } from '../index.js';

/** Truncate a bech32 fast address for compact display. */
const truncAddr = (addr: string): string => (addr.length > 18 ? `${addr.slice(0, 10)}…${addr.slice(-4)}` : addr);

/** Hex-compare two byte arrays. */
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const computeTxHash = (envelope: TransactionEnvelope) =>
  Effect.gen(function* () {
    const bcsInput = yield* Schema.encode(VersionedTransactionFromBcs)(envelope.transaction).pipe(
      Effect.mapError(
        (cause) =>
          new FastSdkError({
            message: 'Failed to encode transaction for hashing',
            cause,
          }),
      ),
    );
    return yield* Effect.tryPromise({
      try: () => hashHex(bcsSchema.VersionedTransaction, bcsInput),
      catch: (cause) =>
        new FastSdkError({
          message: 'Failed to compute transaction hash',
          cause,
        }),
    });
  });

const normalizeHash = (h: string): string => {
  const lower = h.toLowerCase();
  return lower.startsWith('0x') ? lower.slice(2) : lower;
};

const submitResultType = (result: unknown): string | null => (result as { type?: string } | null)?.type ?? null;

export const voteReachedQuorum = (submitResult: unknown): Effect.Effect<boolean, TransactionFailedError> => {
  const type = submitResultType(submitResult);
  if (type === 'Success') return Effect.succeed(true);
  if (type === 'IncompleteMultiSig') return Effect.succeed(false);
  if (type === 'IncompleteVerifierSigs') {
    return Effect.fail(
      new TransactionFailedError({
        message: 'Transaction is pending verifier signatures and cannot be treated as finalized.',
      }),
    );
  }
  return Effect.fail(
    new TransactionFailedError({
      message: `Unexpected submit result for multisig vote: ${type ?? 'missing type'}`,
    }),
  );
};

const transactionOperations = (envelope: TransactionEnvelope) => {
  const value = envelope.transaction.value as {
    readonly claims?: readonly unknown[];
    readonly claim?: unknown;
  };
  if (Array.isArray(value.claims)) return value.claims;
  return value.claim === undefined ? [] : [value.claim];
};

export const makeVoteHistoryEntry = (params: {
  readonly envelope: TransactionEnvelope;
  readonly txHash: string;
  readonly walletFastAddress: string;
  readonly network: string;
  readonly explorerUrl: string | null;
}): HistoryEntry | null => {
  const operations = transactionOperations(params.envelope);
  const op = operations[0] as
    | {
        readonly type: string;
        readonly value?: Record<string, unknown>;
      }
    | undefined;
  if (!op) return null;

  const txValue = params.envelope.transaction.value as {
    readonly sender: Uint8Array;
    readonly nonce: bigint;
  };
  const value = op.value ?? {};
  const tokenId = value.tokenId instanceof Uint8Array ? toHex(value.tokenId) : null;
  const amount = typeof value.amount === 'bigint' ? value.amount.toString() : '0';

  switch (op.type) {
    case 'TokenTransfer': {
      const recipient = value.recipient instanceof Uint8Array ? toFastAddress(value.recipient) : '';
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'transfer',
        from: params.walletFastAddress,
        to: recipient,
        amount,
        formatted: amount,
        tokenName: tokenId ?? '',
        tokenId: tokenId ?? '',
        network: params.network,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        explorerUrl: params.explorerUrl,
      });
    }
    case 'TokenCreation': {
      const createdTokenId = toHex(getTokenId(txValue.sender, txValue.nonce, 0n));
      const initialAmount = typeof value.initialAmount === 'bigint' ? value.initialAmount.toString() : '0';
      const tokenName = typeof value.tokenName === 'string' ? value.tokenName : createdTokenId;
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'token-create',
        from: params.walletFastAddress,
        to: '',
        amount: initialAmount,
        formatted: initialAmount,
        tokenName,
        tokenId: createdTokenId,
        network: params.network,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        explorerUrl: params.explorerUrl,
      });
    }
    case 'Mint': {
      const recipient = value.recipient instanceof Uint8Array ? toFastAddress(value.recipient) : '';
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'token-mint',
        from: params.walletFastAddress,
        to: recipient,
        amount,
        formatted: amount,
        tokenName: tokenId ?? '',
        tokenId: tokenId ?? '',
        network: params.network,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        explorerUrl: params.explorerUrl,
      });
    }
    case 'Burn':
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'token-burn',
        from: params.walletFastAddress,
        to: '',
        amount,
        formatted: amount,
        tokenName: tokenId ?? '',
        tokenId: tokenId ?? '',
        network: params.network,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        explorerUrl: params.explorerUrl,
      });
    case 'TokenManagement':
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'token-manage',
        from: params.walletFastAddress,
        to: '',
        amount: '0',
        formatted: '0',
        tokenName: tokenId ?? '',
        tokenId: tokenId ?? '',
        network: params.network,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        explorerUrl: params.explorerUrl,
      });
    default:
      return null;
  }
};

export const multisigVote: Command<MultisigVoteArgs> = {
  cmd: 'multisig-vote',
  handler: (args) =>
    Effect.gen(function* () {
      const accountsSvc = yield* AccountStore;
      const rpc = yield* FastRpc;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const historyStore = yield* HistoryStore;
      const networks = yield* NetworkConfigService;

      // 1. Resolve active account; refuse if not multisig.
      const account = yield* accountsSvc.resolveAccount(config.account);
      if (account.kind !== 'multisig') {
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: account.name,
            expected: 'multisig',
            hint: 'Select a multisig wallet via --account or "fast account set-default".',
          }),
        );
      }
      yield* ensureMultisigNetwork(account, config.network);

      // 2. Fetch pending list.
      const addressBytes = fromFastAddress(account.fastAddress);
      const raw = yield* rpc.getPendingMultisigTransactions({
        address: addressBytes,
      } as never);
      const envelopes: ReadonlyArray<TransactionEnvelope> = raw as ReadonlyArray<TransactionEnvelope>;

      if (envelopes.length === 0) {
        yield* output.humanLine(`No pending multisig transactions for "${account.name}".`);
        return yield* Effect.fail(
          new TransactionFailedError({
            message: `No pending multisig transactions for "${account.name}".`,
          }),
        );
      }

      // 3. Compute hashes for matching.
      type Entry = { readonly envelope: TransactionEnvelope; readonly hash: string };
      const entries: Entry[] = [];
      for (const envelope of envelopes) {
        const hash = yield* computeTxHash(envelope);
        entries.push({ envelope, hash });
      }

      // 4. Pick target.
      let target: Entry;
      if (args.tx !== undefined) {
        const wanted = normalizeHash(args.tx);
        const found = entries.find((e) => normalizeHash(e.hash) === wanted);
        if (!found) {
          return yield* Effect.fail(
            new TransactionFailedError({
              message: `No pending multisig transaction with hash 0x${wanted} for "${account.name}".`,
            }),
          );
        }
        target = found;
      } else if (entries.length === 1) {
        target = entries[0]!;
      } else {
        const list = entries.map((e) => `  ${e.hash}`).join('\n');
        return yield* Effect.fail(
          new TransactionFailedError({
            message: `Multiple pending transactions for "${account.name}". Pass --tx <hash> to pick one:\n${list}`,
          }),
        );
      }

      if (target.envelope.signature.type !== 'MultiSig') {
        return yield* Effect.fail(
          new TransactionFailedError({
            message: `Pending envelope for ${target.hash} is not a MultiSig signature; cannot vote.`,
          }),
        );
      }

      // 5. Resolve signer (prompts only if the selected member is encrypted).
      const resolved = yield* resolveSigner({
        account,
        asMember: args.asMember,
        network: config.network,
        passwordFor: (member) => (member.encrypted ? prompt.password() : Effect.succeed(null)),
      });
      if (resolved.kind !== 'multisig') {
        // resolveSigner returns multisig for multisig accounts; defensive guard.
        return yield* Effect.fail(
          new WalletKindMismatchError({
            name: account.name,
            expected: 'multisig',
          }),
        );
      }

      // 6. Get my pubkey.
      const myPubkey = yield* Effect.tryPromise({
        try: () => resolved.signer.getSignerPublicKey(),
        catch: (cause) =>
          new TransactionFailedError({
            message: 'Failed to derive signer public key',
            cause,
          }),
      });

      // 7. Refuse double-sign.
      const multisig = target.envelope.signature.value;
      const existingPartials = multisig.signatures;
      const alreadySigned = existingPartials.some(([signer]) => bytesEqual(signer, myPubkey));
      if (alreadySigned) {
        return yield* Effect.fail(
          new AlreadyVotedError({
            walletName: account.name,
            txHash: target.hash,
          }),
        );
      }

      // 8. Display + confirm (unless suppressed).
      const authorizedSigners = multisig.config.authorizedSigners;
      const quorum = Number(multisig.config.quorum);
      const signedCount = existingPartials.length;
      const myAddress = toFastAddress(myPubkey);

      yield* output.humanLine(`Voting on multisig transaction ${target.hash}`);
      yield* output.humanLine(`  Wallet:    ${account.name} (${truncAddr(account.fastAddress)})`);
      yield* output.humanLine(`  As:        ${resolved.memberAccount.name} (${truncAddr(myAddress)})`);
      yield* output.humanLine(`  Progress:  ${signedCount}/${quorum} of ${authorizedSigners.length} signers (you will make ${signedCount + 1})`);
      yield* output.humanLine('');

      const skipConfirm = args.yes || config.nonInteractive || config.json;
      if (!skipConfirm) {
        const confirmed = yield* prompt.confirm('Sign and submit?');
        if (!confirmed) return;
      }

      // 9. Build envelope with my partial sig.
      const myEnvelope = yield* Effect.tryPromise({
        try: () => resolved.signer.signEnvelopeFor(target.envelope.transaction),
        catch: (cause) =>
          new TransactionFailedError({
            message: 'Failed to sign transaction',
            cause,
          }),
      });

      // 10. Submit.
      const submitResult = yield* rpc.submitTransaction(myEnvelope);

      const reachedQuorum = yield* voteReachedQuorum(submitResult);

      if (reachedQuorum) {
        const network = yield* networks.resolve(config.network);
        const historyEntry = makeVoteHistoryEntry({
          envelope: target.envelope,
          txHash: target.hash,
          walletFastAddress: account.fastAddress,
          network: config.network,
          explorerUrl: `${network.explorerUrl}/txs/${target.hash}`,
        });
        if (historyEntry) {
          yield* historyStore.record(historyEntry);
        }
        yield* output.humanLine(`Quorum reached. Transaction ${target.hash} submitted on-chain.`);
      } else {
        yield* output.humanLine(`Partial signature recorded for ${target.hash} (${signedCount + 1}/${quorum}). Awaiting more signers.`);
      }

      yield* output.ok({
        wallet: account.name,
        fastAddress: account.fastAddress,
        txHash: target.hash,
        signedAs: resolved.memberAccount.name,
        signerAddress: myAddress,
        signedCount: signedCount + 1,
        quorum,
        reachedQuorum,
      });
    }),
};
