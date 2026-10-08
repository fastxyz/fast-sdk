import type { AssetAmount, Network, PaymentRequirements, Price, SchemeNetworkServer, SupportedKind } from '@x402/core/types';
import { assertFastNetwork, FAST_DEFAULT_ASSETS } from './constants.js';

const MAX_AMOUNT = (1n << 256n) - 1n;

function validateAsset(asset: string): void {
  if (typeof asset !== 'string' || !/^0x[0-9a-f]{64}$/.test(asset)) {
    throw new Error('Fast asset must be a canonical lowercase 32-byte hex token identifier');
  }
}

function validateAmount(amount: string): void {
  if (typeof amount !== 'string' || !/^[1-9][0-9]{0,77}$/.test(amount) || BigInt(amount) > MAX_AMOUNT) {
    throw new Error('Fast amount must be a positive canonical u256 atomic integer string');
  }
}

/** Exact Fast requirements only; this mechanism does not submit or verify payments. */
export class ExactFastScheme implements SchemeNetworkServer {
  readonly scheme = 'exact';
  readonly defaultAssetTransferMethod = 'default';
  readonly paymentFlows = Object.freeze({
    default: Object.freeze({ supported: Object.freeze(['upfront'] as const), default: 'upfront' as const }),
  });

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    assertFastNetwork(network);
    if (typeof price === 'object' && price !== null) {
      validateAsset(price.asset);
      validateAmount(price.amount);
      return { asset: price.asset, amount: price.amount, ...(price.extra === undefined ? {} : { extra: { ...price.extra } }) };
    }
    if (typeof price === 'number' && (!Number.isFinite(price) || Math.abs(price) > Number.MAX_SAFE_INTEGER)) {
      throw new Error('Fast numeric price must be finite and within the safe integer range; use a decimal string');
    }
    const text = String(price);
    const match = /^\$?(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(text);
    if (!match || text.length > 80) throw new Error('Fast price must be a positive decimal with at most 6 fractional digits');
    const amount = BigInt(match[1] + (match[2] ?? '').padEnd(6, '0')).toString();
    validateAmount(amount);
    return { asset: FAST_DEFAULT_ASSETS[network].asset, amount };
  }

  getAssetDecimals(asset: string, network: Network): number | undefined {
    assertFastNetwork(network);
    const entry = FAST_DEFAULT_ASSETS[network];
    return asset === entry.asset ? entry.decimals : undefined;
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    assertFastNetwork(requirements.network);
    if (requirements.scheme !== this.scheme || supportedKind.scheme !== this.scheme ||
        supportedKind.network !== requirements.network || supportedKind.x402Version !== 2) {
      throw new Error('Fast requirements and facilitator capability must match exact, network and x402 version 2');
    }
    validateAsset(requirements.asset);
    validateAmount(requirements.amount);
    if (requirements.extra.paymentFlow !== undefined && requirements.extra.paymentFlow !== 'upfront') {
      throw new Error('Fast exact supports only upfront payment flow');
    }
    if (requirements.extra.assetTransferMethod !== undefined && requirements.extra.assetTransferMethod !== 'default') {
      throw new Error('Unsupported Fast asset transfer method');
    }
    return { ...requirements, extra: { ...requirements.extra, paymentFlow: 'upfront' } };
  }
}
