import { fromFastAddress, MultiSigSigner, Signer } from '@fastxyz/sdk';
import { Effect } from 'effect';
import { AmbiguousMemberError, NotAMemberError, PasswordRequiredError, UserCancelledError, WalletNetworkMismatchError } from '../errors/index.js';
import { AccountStore, type AccountInfo } from './storage/account.js';

export type ResolvedSigner =
  | {
      readonly kind: 'single';
      readonly signer: Signer;
      readonly account: Extract<AccountInfo, { kind: 'single' }>;
    }
  | {
      readonly kind: 'multisig';
      readonly signer: MultiSigSigner;
      readonly account: Extract<AccountInfo, { kind: 'multisig' }>;
      readonly memberAccount: Extract<AccountInfo, { kind: 'single' }>;
    };

export interface ResolveSignerOptions {
  readonly account: AccountInfo;
  readonly asMember?: string;
  readonly network?: string;
  readonly password?: string | null;
  readonly passwordFor?: (account: SingleAccount) => Effect.Effect<string | null, PasswordRequiredError | UserCancelledError>;
}

type SingleAccount = Extract<AccountInfo, { kind: 'single' }>;
type MultisigAccount = Extract<AccountInfo, { kind: 'multisig' }>;

export const ensureMultisigNetwork = (account: MultisigAccount, activeNetwork: string) => {
  if (account.multisigConfig.network === activeNetwork) return Effect.void;
  return Effect.fail(
    new WalletNetworkMismatchError({
      name: account.name,
      walletNetwork: account.multisigConfig.network,
      activeNetwork,
    }),
  );
};

export const resolveSigner = (opts: ResolveSignerOptions) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;

    if (opts.account.kind === 'single') {
      const password = opts.password !== undefined ? opts.password : opts.passwordFor ? yield* opts.passwordFor(opts.account) : null;
      const { seed } = yield* accounts.export(opts.account.name, password);
      const signer = new Signer(seed);
      return {
        kind: 'single' as const,
        signer,
        account: opts.account,
      };
    }

    // Multisig: find local members whose fast address matches a config signer.
    const config = opts.account.multisigConfig;
    if (opts.network !== undefined) {
      yield* ensureMultisigNetwork(opts.account, opts.network);
    }
    const signerAddrs = new Set(config.signers);
    const localAccounts = yield* accounts.list();
    const candidates = localAccounts.filter((a): a is SingleAccount => a.kind === 'single' && signerAddrs.has(a.fastAddress));

    if (candidates.length === 0) {
      return yield* Effect.fail(new NotAMemberError({ walletName: opts.account.name }));
    }

    let chosen: SingleAccount;
    if (opts.asMember) {
      const found = candidates.find((c) => c.name === opts.asMember);
      if (!found) {
        return yield* Effect.fail(new NotAMemberError({ walletName: opts.account.name }));
      }
      chosen = found;
    } else if (candidates.length > 1) {
      return yield* Effect.fail(
        new AmbiguousMemberError({
          walletName: opts.account.name,
          candidates: candidates.map((c) => c.name),
        }),
      );
    } else {
      chosen = candidates[0]!;
    }

    const password = opts.password !== undefined ? opts.password : opts.passwordFor ? yield* opts.passwordFor(chosen) : null;
    const { seed } = yield* accounts.export(chosen.name, password);
    const signer = new MultiSigSigner({
      config: {
        authorized_signers: config.signers.map((s) => fromFastAddress(s)),
        quorum: BigInt(config.quorum),
        nonce: BigInt(config.configNonce),
      },
      secretKey: seed,
    });

    return {
      kind: 'multisig' as const,
      signer,
      account: opts.account,
      memberAccount: chosen,
    };
  });
