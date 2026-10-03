import { fromFastAddress } from '@fastxyz/sdk';
import { Effect } from 'effect';
import { InvalidAddressError, InvalidAmountError, InvalidUsageError } from '../../errors/index.js';
import { ClientConfig } from '../../services/config/client.js';
import { Output } from '../../services/output.js';
import { AccountStore } from '../../services/storage/account.js';
import { ensureMultisigNetwork } from '../../services/signer-resolver.js';

export const FUND_METHODS = ['card', 'usdc', 'coinbase', 'swapper'] as const;
export type FundMethod = (typeof FUND_METHODS)[number];

const APP_ORIGIN = 'https://app.fast.xyz';

/** Build only one of the four currently supported direct funding links. */
export function buildFundAppUrl(method: FundMethod, address: string, amount?: string): string {
  const path = method === 'coinbase' || method === 'swapper' ? 'crypto' : method;
  const params = new URLSearchParams();
  if (method === 'coinbase' || method === 'swapper') {
    params.set('supplier', method);
  }
  params.set('to', address);
  if (amount !== undefined) params.set('amount', amount);
  return `${APP_ORIGIN}/${path}?${params.toString()}`;
}

const isPositiveDecimal = (value: string): boolean => /^\d+(\.\d+)?$/.test(value) && Number.parseFloat(value) > 0;

export function invalidFundAmount(amount: string | undefined): InvalidAmountError | undefined {
  if (amount === undefined || isPositiveDecimal(amount)) return undefined;
  return new InvalidAmountError({
    message: `Invalid amount "${amount}". Expected a positive decimal (e.g. 10 or 1.5).`,
  });
}

export interface FundAppLinkArgs {
  readonly address?: string;
  readonly amount?: string;
}

export const openFundAppLink = (method: FundMethod, args: FundAppLinkArgs, deprecationMessage?: string) =>
  Effect.gen(function* () {
    const accounts = yield* AccountStore;
    const output = yield* Output;
    const config = yield* ClientConfig;

    if (config.network !== 'mainnet') {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: `Hosted funding links are only available on mainnet. Current network: ${config.network}. Switch with --network mainnet.`,
        }),
      );
    }

    let address: string;
    if (args.address !== undefined) {
      try {
        fromFastAddress(args.address);
        address = args.address;
      } catch {
        return yield* Effect.fail(
          new InvalidAddressError({
            message: `Invalid Fast address "${args.address}". Expected a valid fast1... address.`,
          }),
        );
      }
    } else {
      const account = yield* accounts.resolveAccount(config.account);
      if (account.kind === 'multisig') {
        yield* ensureMultisigNetwork(account, config.network);
      }
      address = account.fastAddress;
    }

    const amountError = invalidFundAmount(args.amount);
    if (amountError) return yield* Effect.fail(amountError);
    if (method === 'usdc' && args.amount !== undefined) {
      return yield* Effect.fail(
        new InvalidUsageError({
          message: 'The hosted USDC route does not support an amount prefill. Choose Card or a crypto supplier to prefill an amount.',
        }),
      );
    }

    if (deprecationMessage) yield* output.humanLine(deprecationMessage);
    const url = buildFundAppUrl(method, address, args.amount);

    yield* output.humanLine('Open this URL to add funds; the Fast-side balance is fastUSD:');
    yield* output.humanLine('');
    yield* output.humanLine(`  ${url}`);
    yield* output.humanLine('');
    yield* output.ok({ url, address, asset: 'fastUSD' });
  });
