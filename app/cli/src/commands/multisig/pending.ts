import { bcsSchema, type TransactionEnvelope, VersionedTransactionFromBcs } from '@fastxyz/schema';
import { fromFastAddress, hashHex, toFastAddress, toHex } from '@fastxyz/sdk';
import { Effect, Schema } from 'effect';
import type { MultisigPendingArgs } from '../../cli.js';
import { FastSdkError, WalletKindMismatchError } from '../../errors/index.js';
import { FastRpc } from '../../services/api/fast.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { ensureMultisigNetwork } from '../../services/signer-resolver.js';
import { AccountStore } from '../../services/storage/account.js';
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

export const multisigPending: Command<MultisigPendingArgs> = {
  cmd: 'multisig-pending',
  handler: (args) =>
    Effect.gen(function* () {
      const accountsSvc = yield* AccountStore;
      const rpc = yield* FastRpc;
      const config = yield* ClientConfig;
      const output = yield* Output;

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

      // 2. Fetch pending transactions.
      const addressBytes = fromFastAddress(account.fastAddress);
      const raw = yield* rpc.getPendingMultisigTransactions({
        address: addressBytes,
      } as never);

      // Decode through the REST schema. The wrapper types as `unknown`; the
      // proxy already calls Schema.decodeUnknown so this is a no-op cast in
      // practice — but going through the schema again gives us the typed
      // shape with no runtime risk.
      const envelopes: ReadonlyArray<TransactionEnvelope> = raw as ReadonlyArray<TransactionEnvelope>;

      // 3. Build a map of local fast addresses → account names.
      const allAccounts = yield* accountsSvc.list();
      const nameByAddress = new Map<string, string>();
      for (const a of allAccounts) {
        nameByAddress.set(a.fastAddress, a.name);
      }

      // 4. If --as <name> is provided, fetch that single-signer account so we
      // can mark its row in each signers grid as "you".
      let asMemberAddress: Uint8Array | null = null;
      let asMemberName: string | null = null;
      if (args.asMember !== undefined) {
        const asAccount = yield* accountsSvc.get(args.asMember);
        if (asAccount.kind !== 'single') {
          return yield* Effect.fail(
            new WalletKindMismatchError({
              name: asAccount.name,
              expected: 'single',
              hint: '--as expects a single-signer account.',
            }),
          );
        }
        asMemberAddress = fromFastAddress(asAccount.fastAddress);
        asMemberName = asAccount.name;
      }

      // 5. Empty list → friendly message + JSON ok.
      if (envelopes.length === 0) {
        yield* output.humanLine(`No pending multisig transactions for "${account.name}".`);
        yield* output.ok({ pending: [] });
        return;
      }

      yield* output.humanLine(`Pending multisig transactions for "${account.name}" (${envelopes.length}):`);
      yield* output.humanLine('');

      type SignerRow = {
        readonly address: string;
        readonly name: string | null;
        readonly signed: boolean;
        readonly isYou: boolean;
      };
      type PendingEntry = {
        readonly hash: string;
        readonly nonce: string;
        readonly version: string;
        readonly quorum: number;
        readonly signedCount: number;
        readonly signers: ReadonlyArray<SignerRow>;
        readonly youSigned: boolean | null;
      };

      const pendingOutput: PendingEntry[] = [];

      for (let i = 0; i < envelopes.length; i++) {
        const envelope = envelopes[i]!;

        // Compute hash.
        const txHash = yield* computeTxHash(envelope);

        // Extract nonce + version from VersionedTransaction.
        const tx = envelope.transaction;
        const nonce = tx.value.nonce.toString();
        const version = tx.type;

        // Extract MultiSig data. Pending transactions should always be MultiSig.
        if (envelope.signature.type !== 'MultiSig') {
          // Defensive fallback: a pending tx with a single Signature is unexpected,
          // but we render a stub row so the user is at least aware of it.
          yield* output.humanLine(`#${i + 1}  hash: ${txHash}`);
          yield* output.humanLine(`     nonce: ${nonce}  version: ${version}`);
          yield* output.humanLine('     (envelope is not a MultiSig — rendering skipped)');
          yield* output.humanLine('');
          pendingOutput.push({
            hash: txHash,
            nonce,
            version,
            quorum: 0,
            signedCount: 0,
            signers: [],
            youSigned: null,
          });
          continue;
        }

        const multisig = envelope.signature.value;
        const authorizedSigners = multisig.config.authorizedSigners;
        const quorum = Number(multisig.config.quorum);
        const sigPairs = multisig.signatures;

        // For each authorized signer, check whether they have signed.
        const signedSet = new Set<string>();
        for (const [signerBytes] of sigPairs) {
          signedSet.add(toHex(signerBytes));
        }

        let youSigned: boolean | null = null;
        const signerRows: SignerRow[] = authorizedSigners.map((signerBytes) => {
          const signerAddr = toFastAddress(signerBytes);
          const localName = nameByAddress.get(signerAddr) ?? null;
          const signed = signedSet.has(toHex(signerBytes));
          const isYou = asMemberAddress !== null && bytesEqual(signerBytes, asMemberAddress);
          if (isYou) youSigned = signed;
          return { address: signerAddr, name: localName, signed, isYou };
        });

        const signedCount = signerRows.filter((r) => r.signed).length;

        // Human render.
        yield* output.humanLine(`#${i + 1}  hash: ${txHash}`);
        yield* output.humanLine(`     nonce: ${nonce}  version: ${version}  signed: ${signedCount}/${quorum} of ${signerRows.length}`);
        yield* output.humanLine('     signers:');
        for (const row of signerRows) {
          const mark = row.signed ? '✓' : '✗';
          const label = row.name ?? truncAddr(row.address);
          const youTag = row.isYou ? '  (you)' : '';
          yield* output.humanLine(`       ${mark} ${label}${youTag}`);
        }
        if (asMemberName !== null) {
          if (youSigned === null) {
            yield* output.humanLine(`     your vote: "${asMemberName}" is not an authorized signer of this multisig`);
          } else {
            yield* output.humanLine(`     your vote: ${youSigned ? 'signed' : 'not signed'} (as "${asMemberName}")`);
          }
        }
        yield* output.humanLine('');

        pendingOutput.push({
          hash: txHash,
          nonce,
          version,
          quorum,
          signedCount,
          signers: signerRows,
          youSigned,
        });
      }

      yield* output.ok({
        wallet: account.name,
        fastAddress: account.fastAddress,
        pending: pendingOutput,
      });
    }),
};
