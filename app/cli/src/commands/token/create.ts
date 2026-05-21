import { fromFastAddress, getTokenId, toHex } from '@fastxyz/sdk';
import { Effect } from 'effect';
import type { TokenCreateArgs } from '../../cli.js';
import { InvalidAddressError, InvalidAmountError, TransactionFailedError } from '../../errors/index.js';
import { makeHistoryEntry } from '../../schemas/history.js';
import { FastRpc } from '../../services/api/fast.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { Prompt } from '../../services/prompt.js';
import { resolveSigner } from '../../services/signer-resolver.js';
import { AccountStore } from '../../services/storage/account.js';
import { HistoryStore } from '../../services/storage/history.js';
import { NetworkConfigService } from '../../services/storage/network.js';
import { submitOperation } from '../../services/tx-pipeline.js';
import type { Command } from '../index.js';

const encodeMemo = (s: string | undefined): Uint8Array | null => {
  if (!s) return null;
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 32) {
    throw new InvalidAmountError({
      message: `--memo too long: ${bytes.length} bytes (max 32)`,
    });
  }
  const padded = new Uint8Array(32);
  padded.set(bytes, 0);
  return padded;
};

const parseAmount = (s: string, decimals: number): bigint => {
  const trimmed = s.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError({
      message: `--initial-supply not a non-negative decimal: "${s}"`,
    });
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new InvalidAmountError({
      message: `--initial-supply has more fractional digits (${frac.length}) than decimals (${decimals})`,
    });
  }
  const scaled = `${whole}${frac.padEnd(decimals, '0')}`;
  return BigInt(scaled);
};

export const tokenCreate: Command<TokenCreateArgs> = {
  cmd: 'token-create',
  handler: (args) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networks = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;
      const prompt = yield* Prompt;
      const historyStore = yield* HistoryStore;
      yield* FastRpc;

      if (args.decimals < 0 || args.decimals > 18) {
        return yield* Effect.fail(
          new InvalidAmountError({
            message: `--decimals must be between 0 and 18 (got ${args.decimals})`,
          }),
        );
      }

      const initialSupply = yield* Effect.try({
        try: () => parseAmount(args.initialSupply, args.decimals),
        catch: (e) => e as InvalidAmountError,
      });

      const minterEntries = (args.minters ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const minterBytes: Uint8Array[] = [];
      for (const m of minterEntries) {
        if (!m.startsWith('fast1')) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `--minters entry "${m}" is not a bech32 fast1... address`,
            }),
          );
        }
        try {
          minterBytes.push(fromFastAddress(m));
        } catch (cause) {
          return yield* Effect.fail(
            new InvalidAddressError({
              message: `--minters entry "${m}" is not a valid bech32 address: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
          );
        }
      }

      const userData = yield* Effect.try({
        try: () => encodeMemo(args.memo),
        catch: (e) => e as InvalidAmountError,
      });

      const accountInfo = yield* accounts.resolveAccount(config.account);
      const resolved = yield* resolveSigner({
        account: accountInfo,
        asMember: args.asMember,
        passwordFor: (member) => (member.encrypted ? prompt.password() : Effect.succeed(null)),
      });

      const network = yield* networks.resolve(config.network);

      if (!config.nonInteractive && !config.json) {
        yield* output.humanLine(`Create token "${args.name}"`);
        yield* output.humanLine(`  Decimals:       ${args.decimals}`);
        yield* output.humanLine(`  Initial supply: ${args.initialSupply}`);
        yield* output.humanLine(`  Minters:        ${minterEntries.length > 0 ? minterEntries.join(', ') : '(admin only)'}`);
        yield* output.humanLine(`  Admin:          ${accountInfo.fastAddress}`);
        const ok = yield* prompt.confirm('Confirm?');
        if (!ok) return;
      }

      const result = yield* submitOperation({
        resolved,
        networkId: network.networkId as never,
        operation: {
          type: 'TokenCreation',
          value: {
            tokenName: args.name,
            decimals: args.decimals,
            initialAmount: initialSupply,
            mints: minterBytes,
            userData,
          } as never,
        },
      });

      if (result.status === 'incomplete-multisig') {
        const quorum = resolved.kind === 'multisig' ? resolved.account.multisigConfig.quorum : 1;
        yield* output.humanLine(`Submitted as multisig partial: 1/${quorum} signatures collected.`);
        yield* output.humanLine(`Cosigners can run \`fast multisig pending\` to view, \`fast multisig vote\` to sign.`);
        yield* output.ok({
          status: 'incomplete-multisig',
          tokenName: args.name,
          wallet: accountInfo.name,
        });
        return;
      }

      // Record in local history (only on success — incomplete-multisig has no cert)
      const senderBytes = yield* Effect.tryPromise({
        try: () => (resolved.kind === 'single' ? resolved.signer.getPublicKey() : resolved.signer.getDerivedAddressBytes()),
        catch: (cause) =>
          new TransactionFailedError({
            message: 'Failed to derive sender bytes for token id',
            cause,
          }),
      });
      const tokenId = getTokenId(senderBytes, result.nonce, 0n);
      const explorerUrl = `${network.explorerUrl}/txs/${result.txHash}`;
      yield* historyStore.record(
        makeHistoryEntry({
          hash: result.txHash,
          type: 'token-create',
          from: accountInfo.fastAddress,
          to: '',
          amount: initialSupply.toString(),
          formatted: args.initialSupply,
          tokenName: args.name,
          tokenId: toHex(tokenId),
          network: config.network,
          status: 'confirmed',
          timestamp: new Date().toISOString(),
          explorerUrl,
        }),
      );

      yield* output.humanLine(`Created token "${args.name}".`);
      yield* output.humanLine(`  Transaction: ${result.txHash}`);
      yield* output.ok({
        status: 'success',
        tokenName: args.name,
        decimals: args.decimals,
        initialSupply: args.initialSupply,
        txHash: result.txHash,
        admin: accountInfo.fastAddress,
        tokenId: toHex(tokenId),
      });
    }),
};
