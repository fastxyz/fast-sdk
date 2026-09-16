import { bcsSchema, type TransactionEnvelope, VersionedTransactionFromBcs } from '@fastxyz/schema';
import { fromFastAddress, getTokenId, hashHex, toFastAddress, toHex } from '@fastxyz/sdk';
import { Effect, Schema } from 'effect';
import type { MultisigVoteArgs } from '../../cli.js';
import { FastSdkError, TransactionFailedError, TransactionSubmissionUnknownError, WalletKindMismatchError } from '../../errors/index.js';
import { makeHistoryEntry, type HistoryEntry } from '../../schemas/history.js';
import { FastRpc } from '../../services/api/fast.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { Prompt } from '../../services/prompt.js';
import { ensureMultisigNetwork, resolveSigner } from '../../services/signer-resolver.js';
import { AccountStore } from '../../services/storage/account.js';
import { HistoryStore, recordConfirmedHistory } from '../../services/storage/history.js';
import { NetworkConfigService } from '../../services/storage/network.js';
import { summarizeTransaction, transactionOperations } from '../../services/transaction-summary.js';
import { classifySubmissionError, prepareSubmissionRecovery } from '../../services/tx-pipeline.js';
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

type VoteTokenMetadata = {
  readonly tokenName: string;
  readonly decimals: number;
};

const formatAmount = (amount: bigint, decimals: number): string => {
  if (decimals === 0) return amount.toString();
  const padded = amount.toString().padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
};

export const makeVoteHistoryEntry = (params: {
  readonly envelope: TransactionEnvelope;
  readonly txHash: string;
  readonly walletFastAddress: string;
  readonly network: string;
  readonly explorerUrl: string | null;
  readonly tokenMetadata?: VoteTokenMetadata;
}): HistoryEntry | null => {
  const operations = transactionOperations(params.envelope.transaction);
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
  const amountRaw = typeof value.amount === 'bigint' ? value.amount : 0n;
  const amount = amountRaw.toString();
  const tokenName = params.tokenMetadata?.tokenName ?? tokenId ?? '';
  const formatted = formatAmount(amountRaw, params.tokenMetadata?.decimals ?? 0);

  switch (op.type) {
    case 'TokenTransfer': {
      const recipient = value.recipient instanceof Uint8Array ? toFastAddress(value.recipient) : '';
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'transfer',
        from: params.walletFastAddress,
        to: recipient,
        amount,
        formatted,
        tokenName,
        tokenId: tokenId ?? '',
        network: params.network,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        explorerUrl: params.explorerUrl,
      });
    }
    case 'TokenCreation': {
      const createdTokenId = toHex(getTokenId(txValue.sender, txValue.nonce, 0n));
      const initialAmountRaw = typeof value.initialAmount === 'bigint' ? value.initialAmount : 0n;
      const initialAmount = initialAmountRaw.toString();
      const tokenName = typeof value.tokenName === 'string' ? value.tokenName : createdTokenId;
      const decimals = typeof value.decimals === 'number' ? value.decimals : 0;
      return makeHistoryEntry({
        hash: params.txHash,
        type: 'token-create',
        from: params.walletFastAddress,
        to: '',
        amount: initialAmount,
        formatted: formatAmount(initialAmountRaw, decimals),
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
        formatted,
        tokenName,
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
        formatted,
        tokenName,
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
        tokenName,
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
      const accountInfo = yield* rpc.getAccountInfo({
        address: addressBytes,
        tokenBalancesFilter: null,
        stateKeyFilter: null,
        certificateByNonce: null,
      } as never);
      const nextNonce = (accountInfo as { nextNonce?: bigint } | null)?.nextNonce ?? 0n;
      const envelopes = (raw as ReadonlyArray<TransactionEnvelope>).filter((envelope) => envelope.transaction.value.nonce === nextNonce);

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

      const network = yield* networks.resolve(config.network);
      const txValue = target.envelope.transaction.value as {
        readonly sender: Uint8Array;
        readonly networkId?: string;
      };
      if (!bytesEqual(txValue.sender, addressBytes)) {
        return yield* Effect.fail(
          new TransactionFailedError({
            message: `Pending transaction sender does not match multisig wallet ${account.fastAddress}.`,
          }),
        );
      }
      if (txValue.networkId !== network.networkId) {
        return yield* Effect.fail(
          new TransactionFailedError({
            message: `Pending transaction network ${txValue.networkId ?? '<missing>'} does not match ${network.networkId}.`,
          }),
        );
      }
      const storedConfig = account.multisigConfig;
      const envelopeConfig = target.envelope.signature.value.config;
      const configMatches =
        envelopeConfig.quorum === BigInt(storedConfig.quorum) &&
        envelopeConfig.nonce === BigInt(storedConfig.configNonce) &&
        envelopeConfig.authorizedSigners.length === storedConfig.signers.length &&
        envelopeConfig.authorizedSigners.every((signer, index) => bytesEqual(signer, fromFastAddress(storedConfig.signers[index]!)));
      if (!configMatches) {
        return yield* Effect.fail(
          new TransactionFailedError({
            message: 'Pending transaction multisig config does not match the stored wallet config.',
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

      // 7. Detect retry of an already-recorded partial signature.
      const multisig = target.envelope.signature.value;
      const existingPartials = multisig.signatures;
      const alreadySigned = existingPartials.some(([signer]) => bytesEqual(signer, myPubkey));

      // 8. Display + confirm (unless suppressed).
      const authorizedSigners = multisig.config.authorizedSigners;
      const quorum = Number(multisig.config.quorum);
      const signedCount = existingPartials.length;
      const projectedSignedCount = alreadySigned ? signedCount : signedCount + 1;
      const myAddress = toFastAddress(myPubkey);

      yield* output.humanLine(`Voting on multisig transaction ${target.hash}`);
      yield* output.humanLine(`  Wallet:    ${account.name} (${truncAddr(account.fastAddress)})`);
      yield* output.humanLine(`  As:        ${resolved.memberAccount.name} (${truncAddr(myAddress)})`);
      yield* output.humanLine(`  Progress:  ${signedCount}/${quorum} of ${authorizedSigners.length} signers (submission: ${projectedSignedCount})`);
      for (const line of summarizeTransaction(target.envelope)) {
        yield* output.humanLine(line);
      }
      if (alreadySigned) {
        yield* output.humanLine('  Retry:     your signature is already recorded; this will resubmit it to retry execution.');
      }
      yield* output.humanLine('');

      const skipConfirm = args.yes || config.nonInteractive || config.json;
      if (!skipConfirm) {
        const confirmed = yield* prompt.confirm(alreadySigned ? 'Resubmit existing signature?' : 'Sign and submit?');
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

      // 10. Freeze the exact recovery identity before submitting. If the
      // response is lost, rebuilding would change the timestamp and can replay
      // an already-settled operation at the next nonce.
      const recovery = yield* prepareSubmissionRecovery(myEnvelope);
      if (normalizeHash(recovery.txHash) !== normalizeHash(target.hash)) {
        return yield* Effect.fail(
          new TransactionFailedError({
            message: 'Signed vote transaction hash changed unexpectedly before submission.',
          }),
        );
      }
      const submitResult = yield* rpc.submitTransaction(myEnvelope).pipe(
        Effect.mapError((cause) =>
          classifySubmissionError({
            txHash: recovery.txHash,
            nonce: target.envelope.transaction.value.nonce,
            envelope: myEnvelope,
            recoveryEnvelope: recovery.recoveryEnvelope,
            cause,
          }),
        ),
      );

      const reachedQuorum = yield* voteReachedQuorum(submitResult);

      if (reachedQuorum) {
        // Metadata only enriches local history. Never let an index/metadata
        // outage block signing, quorum, or a successfully settled operation.
        const firstOperation = transactionOperations(target.envelope.transaction)[0];
        const firstValue = firstOperation?.value as { readonly tokenId?: unknown } | undefined;
        let historyTokenMetadata: VoteTokenMetadata | undefined;
        if (firstValue?.tokenId instanceof Uint8Array) {
          const tokenInfo = (yield* rpc
            .getTokenInfo({ tokenIds: [firstValue.tokenId] } as never)
            .pipe(Effect.catchAll(() => Effect.succeed(null)))) as {
            readonly requestedTokenMetadata?: ReadonlyArray<readonly [Uint8Array, VoteTokenMetadata | null]>;
          } | null;
          historyTokenMetadata = tokenInfo?.requestedTokenMetadata?.[0]?.[1] ?? undefined;
        }
        const historyEntry = makeVoteHistoryEntry({
          envelope: target.envelope,
          txHash: target.hash,
          walletFastAddress: account.fastAddress,
          network: config.network,
          explorerUrl: `${network.explorerUrl}/txs/${target.hash}`,
          tokenMetadata: historyTokenMetadata,
        });
        if (historyEntry) yield* recordConfirmedHistory(historyStore, output, historyEntry);
        yield* output.humanLine(`Quorum reached. Transaction ${target.hash} submitted on-chain.`);
      } else {
        yield* output.humanLine(`Partial signature recorded for ${target.hash} (${projectedSignedCount}/${quorum}). Awaiting more signers.`);
      }

      yield* output.ok({
        wallet: account.name,
        fastAddress: account.fastAddress,
        txHash: target.hash,
        signedAs: resolved.memberAccount.name,
        signerAddress: myAddress,
        signedCount: projectedSignedCount,
        quorum,
        reachedQuorum,
      });
    }),
};
