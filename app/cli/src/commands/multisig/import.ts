import {
  deriveMultiSigAddress,
  fromFastAddress,
  type MultiSigConfig,
} from "@fastxyz/sdk";
import { Effect, Schema } from "effect";
import { readFileSync } from "node:fs";

import type { MultisigImportArgs } from "../../cli.js";
import {
  AddressDerivationMismatchError,
  FileIOError,
  InvalidAddressError,
  InvalidUsageError,
  MultiSigConfigInvalidError,
} from "../../errors/index.js";
import {
  MultiSigWalletConfigSchema,
  parseMultiSigWalletConfig,
  type MultiSigWalletConfig,
} from "../../schemas/multisig-wallet.js";
import { ClientConfig } from "../../services/config/client.js";
import { Output } from "../../services/output.js";
import { AccountStore } from "../../services/storage/account.js";
import { validateName } from "../../services/validate.js";
import type { Command } from "../index.js";

const FAST_ADDRESS_PREFIX = "fast1";

const validateFastAddress = (entry: string) =>
  Effect.gen(function* () {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: "Empty signer entry in --signers list",
        }),
      );
    }
    if (!trimmed.startsWith(FAST_ADDRESS_PREFIX)) {
      return yield* Effect.fail(
        new InvalidAddressError({
          message: `Signer "${trimmed}" is not a fast1 address (account-name lookup is only supported by \`fast multisig init\`)`,
        }),
      );
    }
    yield* Effect.try({
      try: () => fromFastAddress(trimmed),
      catch: (cause) =>
        new InvalidAddressError({
          message: `Invalid fast address "${trimmed}": ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
    return trimmed;
  });

const deriveAddress = (
  signersSorted: readonly string[],
  quorum: number,
  configNonce: bigint,
) =>
  Effect.gen(function* () {
    const sdkConfig: MultiSigConfig = {
      authorized_signers: signersSorted.map((s) => fromFastAddress(s)),
      quorum: BigInt(quorum),
      nonce: configNonce,
    };
    return yield* Effect.tryPromise({
      try: () => deriveMultiSigAddress(sdkConfig),
      catch: (cause) =>
        new MultiSigConfigInvalidError({
          reason: `failed to derive multisig address: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  });

export const multisigImport: Command<MultisigImportArgs> = {
  cmd: "multisig-import",
  handler: (args: MultisigImportArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const config = yield* ClientConfig;
      const output = yield* Output;

      let walletConfig: MultiSigWalletConfig;

      if ("from" in args && args.from) {
        // Mode 1: load from file and verify integrity.
        const filePath = args.from;
        const content = yield* Effect.try({
          try: () => readFileSync(filePath, "utf-8"),
          catch: (e) =>
            new FileIOError({
              message: `Cannot read wallet config file: ${e instanceof Error ? e.message : String(e)}`,
              cause: e,
            }),
        });

        const parsed = yield* parseMultiSigWalletConfig(content).pipe(
          Effect.mapError(
            (e) =>
              new MultiSigConfigInvalidError({
                reason: e instanceof Error ? e.message : String(e),
              }),
          ),
        );

        // Verify each signer is a valid bech32 fast address before deriving.
        for (const s of parsed.signers) {
          yield* validateFastAddress(s);
        }

        // Use canonical (sorted) order for derivation; this matches what
        // `multisig init` writes, so a well-formed file already round-trips.
        const sortedSigners = [...parsed.signers].sort();

        let nonceBig: bigint;
        try {
          nonceBig = BigInt(parsed.configNonce);
        } catch {
          return yield* Effect.fail(
            new MultiSigConfigInvalidError({
              reason: `configNonce is not a valid u64: "${parsed.configNonce}"`,
            }),
          );
        }

        const derived = yield* deriveAddress(
          sortedSigners,
          parsed.quorum,
          nonceBig,
        );
        if (derived !== parsed.fastAddress) {
          return yield* Effect.fail(
            new AddressDerivationMismatchError({
              expected: parsed.fastAddress,
              derived,
            }),
          );
        }

        // Apply CLI overrides on top of the file config.
        const finalName = args.name ?? parsed.name;
        const finalNetwork = args.network ?? parsed.network;

        const nameErr = validateName(finalName, "Wallet name");
        if (nameErr) {
          return yield* Effect.fail(new InvalidUsageError({ message: nameErr }));
        }

        walletConfig = {
          version: 1,
          name: finalName,
          signers: sortedSigners,
          quorum: parsed.quorum,
          configNonce: parsed.configNonce,
          fastAddress: parsed.fastAddress,
          network: finalNetwork,
        };
      } else {
        // Mode 2: explicit args.
        if (!("signers" in args)) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message:
                "Either --from <file> or --signers/--quorum/--config-nonce must be provided",
            }),
          );
        }
        if (!args.name) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message: "--name is required when not using --from",
            }),
          );
        }

        const nameErr = validateName(args.name, "Wallet name");
        if (nameErr) {
          return yield* Effect.fail(new InvalidUsageError({ message: nameErr }));
        }

        const rawEntries = args.signers
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (rawEntries.length < 2) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message: "--signers must list at least 2 entries",
            }),
          );
        }

        const validated: string[] = [];
        for (const entry of rawEntries) {
          validated.push(yield* validateFastAddress(entry));
        }

        const dedupedSorted = Array.from(new Set(validated)).sort();
        if (dedupedSorted.length !== validated.length) {
          return yield* Effect.fail(
            new MultiSigConfigInvalidError({
              reason: "duplicate signers in --signers list",
            }),
          );
        }

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

        const derived = yield* deriveAddress(
          dedupedSorted,
          args.quorum,
          nonceBig,
        );
        if (args.expectAddress && derived !== args.expectAddress) {
          return yield* Effect.fail(
            new AddressDerivationMismatchError({
              expected: args.expectAddress,
              derived,
            }),
          );
        }

        const network = args.network ?? config.network;

        const candidate = {
          version: 1 as const,
          name: args.name,
          signers: dedupedSorted,
          quorum: args.quorum,
          configNonce: args.configNonce,
          fastAddress: derived,
          network,
        };
        walletConfig = yield* Schema.decodeUnknown(MultiSigWalletConfigSchema)(
          candidate,
        ).pipe(
          Effect.mapError(
            (e) =>
              new MultiSigConfigInvalidError({
                reason: e instanceof Error ? e.message : String(e),
              }),
          ),
        );
      }

      // Insert the row.
      const entry = yield* accounts.createMultiSig(walletConfig, args.setDefault);

      // Human output.
      yield* output.humanLine(`Imported multisig wallet "${entry.name}"`);
      yield* output.humanLine(`  Fast address: ${entry.fastAddress}`);
      yield* output.humanLine(`  Network:      ${entry.multisigConfig.network}`);
      yield* output.humanLine(
        `  Quorum:       ${entry.multisigConfig.quorum} of ${entry.multisigConfig.signers.length}`,
      );
      yield* output.humanLine(`  Config nonce: ${entry.multisigConfig.configNonce}`);
      yield* output.humanLine("  Signers:");
      for (const s of entry.multisigConfig.signers) {
        yield* output.humanLine(`    - ${s}`);
      }
      if (entry.isDefault) {
        yield* output.humanLine("  (set as default account)");
      }

      // JSON output.
      yield* output.ok({
        name: entry.name,
        fastAddress: entry.fastAddress,
        kind: "multisig" as const,
        isDefault: entry.isDefault,
        multisigConfig: entry.multisigConfig,
      });
    }),
};
