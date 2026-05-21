import { deriveMultiSigAddress, fromFastAddress, type MultiSigConfig } from '@fastxyz/sdk';
import { Effect, Schema } from 'effect';
import type { MultisigInitArgs } from '../../cli.js';
import { InvalidAddressError, InvalidUsageError, MultiSigConfigInvalidError, WalletKindMismatchError } from '../../errors/index.js';
import { MultiSigWalletConfigSchema, type MultiSigWalletConfig } from '../../schemas/multisig-wallet.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { AccountStore } from '../../services/storage/account.js';
import { validateName } from '../../services/validate.js';
import type { Command } from '../index.js';

const FAST_ADDRESS_PREFIX = 'fast1';

/**
 * Resolve a single `--signers` entry to a bech32 fast address.
 * If the entry already starts with `fast1`, treat it as an address.
 * Otherwise, look it up as a local account name.
 */
const resolveSignerEntry = (entry: string) =>
  Effect.gen(function* () {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: 'Empty signer entry in --signers list',
        }),
      );
    }

    if (trimmed.startsWith(FAST_ADDRESS_PREFIX)) {
      // Validate by attempting bech32 decode; fail with a friendly error.
      yield* Effect.try({
        try: () => fromFastAddress(trimmed),
        catch: (cause) =>
          new InvalidAddressError({
            message: `Invalid fast address "${trimmed}": ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });
      return trimmed;
    }

    // Treat as local account name.
    const accounts = yield* AccountStore;
    const account = yield* accounts.get(trimmed);
    if (account.kind !== 'single') {
      return yield* Effect.fail(
        new WalletKindMismatchError({
          name: account.name,
          expected: 'single',
          hint: '--signers local account names must refer to single-signer accounts.',
        }),
      );
    }
    return account.fastAddress;
  });

export const multisigInit: Command<MultisigInitArgs> = {
  cmd: 'multisig-init',
  handler: (args: MultisigInitArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const config = yield* ClientConfig;
      const output = yield* Output;

      // Validate alias.
      const nameErr = validateName(args.name, 'Wallet name');
      if (nameErr) {
        return yield* Effect.fail(new InvalidUsageError({ message: nameErr }));
      }

      // Parse + resolve signer entries.
      const rawEntries = args.signers
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (rawEntries.length < 2) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: '--signers must list at least 2 entries',
          }),
        );
      }

      const resolved: string[] = [];
      for (const entry of rawEntries) {
        resolved.push(yield* resolveSignerEntry(entry));
      }

      // Sort + dedupe (canonical order: lexicographic by bech32 string).
      const dedupedSorted = Array.from(new Set(resolved)).sort();
      if (dedupedSorted.length !== resolved.length) {
        return yield* Effect.fail(
          new MultiSigConfigInvalidError({
            reason: 'duplicate signers in --signers list',
          }),
        );
      }

      // Validate config-nonce parses as u64 decimal.
      if (!/^\d+$/.test(args.configNonce)) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `--config-nonce must be a non-negative integer (got "${args.configNonce}")`,
          }),
        );
      }
      let nonceBig: bigint;
      try {
        nonceBig = BigInt(args.configNonce);
      } catch {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `--config-nonce is not a valid u64: "${args.configNonce}"`,
          }),
        );
      }

      // Resolve network.
      const network = config.network;

      // Derive the multisig fast address.
      const sdkConfig: MultiSigConfig = {
        authorized_signers: dedupedSorted.map((s) => fromFastAddress(s)),
        quorum: BigInt(args.quorum),
        nonce: nonceBig,
      };
      const fastAddress = yield* Effect.tryPromise({
        try: () => deriveMultiSigAddress(sdkConfig),
        catch: (cause) =>
          new MultiSigConfigInvalidError({
            reason: `failed to derive multisig address: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });

      // Build + validate the wallet config (catches quorum bounds, etc.).
      const candidate = {
        version: 1 as const,
        name: args.name,
        signers: dedupedSorted,
        quorum: args.quorum,
        configNonce: args.configNonce,
        fastAddress,
        network,
      };
      const walletConfig: MultiSigWalletConfig = yield* Schema.decodeUnknown(MultiSigWalletConfigSchema)(candidate).pipe(
        Effect.mapError(
          (e) =>
            new MultiSigConfigInvalidError({
              reason: e instanceof Error ? e.message : String(e),
            }),
        ),
      );

      // Insert the row.
      const entry = yield* accounts.createMultiSig(walletConfig, args.setDefault);

      // Human output.
      yield* output.humanLine(`Created multisig wallet "${entry.name}"`);
      yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
      yield* output.humanLine(`  Network:      ${entry.multisigConfig.network}`);
      yield* output.humanLine(`  Quorum:       ${entry.multisigConfig.quorum} of ${entry.multisigConfig.signers.length}`);
      yield* output.humanLine(`  Config nonce: ${entry.multisigConfig.configNonce}`);
      yield* output.humanLine('  Signers:');
      for (const s of entry.multisigConfig.signers) {
        yield* output.humanLine(`    - ${s}`);
      }
      if (entry.isDefault) {
        yield* output.humanLine('  (set as default account)');
      }

      // JSON output.
      yield* output.ok({
        name: entry.name,
        fastAddress: entry.fastAddress,
        kind: 'multisig' as const,
        isDefault: entry.isDefault,
        multisigConfig: entry.multisigConfig,
      });
    }),
};
