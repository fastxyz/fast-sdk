import { fromHex, toHex } from '@fastxyz/sdk';
import { bech32m } from 'bech32';
import { Clock, Effect } from 'effect';
import type { WaitForPaymentArgs } from '../cli.js';
import {
  ExplorerNotConfiguredError,
  InvalidAddressError,
  type InvalidAmountError,
  InvalidUsageError,
  TokenNotFoundError,
  type UnsupportedChainError,
} from '../errors/index.js';
import { formatBaseUnits, parsePositiveAmount } from '../services/amount.js';
import { historyTypeOf, nsToMs, parseIsoTimestampNs } from '../services/api/explorer.js';
import { FastRpc } from '../services/api/fast.js';
import { ClientConfig } from '../services/config/client.js';
import { validateWaitTimeoutSeconds, waitForIncoming } from '../services/incoming-payments.js';
import { Output } from '../services/output.js';
import { ensureMultisigNetwork } from '../services/signer-resolver.js';
import { AccountStore } from '../services/storage/account.js';
import { NetworkConfigService } from '../services/storage/network.js';
import { findRequestedTokenMetadata } from '../services/token-metadata.js';
import { lookupFastTokenById, resolveToken } from '../services/token-resolver.js';
import type { Command } from './index.js';

const HEX_TOKEN_ID = /^(0x)?[0-9a-fA-F]{64}$/;

/** Validate a fast1… address (bech32m, 32-byte payload) and return it lowercased. */
const parseFastAddress = (flag: string, value: string): Effect.Effect<string, InvalidAddressError> =>
  Effect.try({
    try: () => {
      const decoded = bech32m.decode(value);
      if (decoded.prefix !== 'fast' || bech32m.fromWords(decoded.words).length !== 32) throw new Error('not a fast address');
      return value.toLowerCase();
    },
    catch: () => new InvalidAddressError({ message: `${flag} "${value}" is not a valid fast1... address.` }),
  });

export const waitForPayment: Command<WaitForPaymentArgs> = {
  cmd: 'wait-for-payment',
  handler: (args: WaitForPaymentArgs) =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore;
      const networkConfig = yield* NetworkConfigService;
      const config = yield* ClientConfig;
      const output = yield* Output;

      const startedAt = yield* Clock.currentTimeMillis;

      const timeoutSeconds = yield* validateWaitTimeoutSeconds(args.timeout);
      let sinceMs = startedAt;
      let sinceNs = BigInt(startedAt) * 1_000_000n;
      if (args.since !== undefined) {
        // Kept to the nanosecond: a payment earlier within the same millisecond must not match.
        const parsed = parseIsoTimestampNs(args.since);
        if (parsed === null) {
          return yield* Effect.fail(
            new InvalidUsageError({
              message: `--since "${args.since}" is not a valid ISO 8601 time (e.g. 2026-10-02T12:00:00Z; impossible dates such as 2026-02-30 are rejected).`,
            }),
          );
        }
        sinceNs = parsed;
        sinceMs = nsToMs(parsed);
      }

      const network = yield* networkConfig.resolve(config.network);
      if (!network.explorerApiUrl) {
        return yield* Effect.fail(new ExplorerNotConfiguredError({ network: config.network }));
      }

      // Token: explicit --token (symbol or id) or the network default, as in `fast send`.
      const tokenInput = args.token ?? network.defaultToken?.symbol;
      if (tokenInput === undefined) {
        return yield* Effect.fail(
          new InvalidUsageError({
            message: `No default token found on ${config.network}; please specify a token.`,
          }),
        );
      }
      let tokenId: string;
      let tokenLabel: string;
      let decimals: number;
      if (HEX_TOKEN_ID.test(tokenInput)) {
        tokenId = toHex(fromHex(tokenInput)).toLowerCase();
        const known = lookupFastTokenById(network, tokenId);
        if (known) {
          tokenLabel = known.name;
          decimals = known.decimals;
        } else {
          // Not in the network config (e.g. a token made with `fast token create`): read its decimals on-chain.
          const rpc = yield* FastRpc;
          const info = (yield* rpc.getTokenInfo({ tokenIds: [fromHex(tokenId)] } as never)) as {
            requestedTokenMetadata?: ReadonlyArray<readonly [Uint8Array, { tokenName?: string; decimals: number } | null]>;
          };
          const metadata = findRequestedTokenMetadata(info.requestedTokenMetadata, fromHex(tokenId));
          if (!metadata) return yield* Effect.fail(new TokenNotFoundError({ token: tokenInput }));
          tokenLabel = metadata.tokenName || tokenId;
          decimals = metadata.decimals;
        }
      } else {
        const resolved = yield* Effect.try({
          try: () => resolveToken(tokenInput, network),
          catch: (e) => e as TokenNotFoundError | UnsupportedChainError,
        });
        tokenId = toHex(resolved.fastTokenId).toLowerCase();
        tokenLabel = tokenInput;
        decimals = resolved.decimals;
      }

      const amountRaw = yield* Effect.try({
        try: () => parsePositiveAmount(args.amount, decimals, tokenLabel),
        catch: (e) => e as InvalidAmountError,
      });
      const amountLabel = `${formatBaseUnits(amountRaw, decimals)} ${tokenLabel}`;

      let address: string;
      if (args.to !== undefined) {
        address = yield* parseFastAddress('--to', args.to);
      } else {
        const account = yield* accounts.resolveAccount(config.account);
        if (account.kind === 'multisig') yield* ensureMultisigNetwork(account, config.network);
        address = account.fastAddress;
      }
      const from = args.from !== undefined ? yield* parseFastAddress('--from', args.from) : undefined;
      const since = new Date(sinceMs);
      const expected = `${amountLabel} to ${address}${from ? ` from ${from}` : ''} since ${args.since?.trim() ?? since.toISOString()}`;

      yield* output.humanLine(`Waiting up to ${timeoutSeconds}s for ${expected}...`);

      const payment = yield* waitForIncoming({
        address,
        amountRaw,
        tokenId,
        from,
        since,
        sinceNs,
        timeoutMs: timeoutSeconds * 1000,
        description: expected,
      });

      yield* output.humanLine(`Payment received: ${amountLabel} from ${payment.from}`);
      yield* output.humanLine(`  Transaction: ${payment.hash}`);
      yield* output.humanLine(`  Time:        ${payment.timestamp}`);
      yield* output.humanLine(`  Explorer:    ${payment.explorerUrl}`);
      yield* output.ok({
        hash: payment.hash,
        type: historyTypeOf(payment.type),
        from: payment.from,
        to: payment.to,
        amount: payment.amount.toString(),
        formatted: formatBaseUnits(payment.amount, decimals),
        tokenName: tokenLabel,
        tokenId: payment.tokenId,
        timestamp: payment.timestamp,
        explorerUrl: payment.explorerUrl,
        network: config.network,
      });
    }),
};
