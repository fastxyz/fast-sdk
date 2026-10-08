import {
  fromV2,
  fromV2PaymentPayload,
  getNetworkType,
  toCanonicalNetwork,
  type PaymentPayload,
  type PaymentPayloadV2,
  type PaymentRequirement,
  type PaymentRequirementV2,
} from '@fastxyz/x402-types';
import type { FacilitatorConfig } from './types.js';

/** Seller-supplied expected terms, never the payer's accepted offer, are trusted. */
export function normalizePayment(
  payload: PaymentPayload | PaymentPayloadV2,
  requirement: PaymentRequirement | PaymentRequirementV2,
  config: FacilitatorConfig,
): { payload: PaymentPayload; requirement: PaymentRequirement } {
  // Release 1 supports only already-paid Fast certificates on the native wire.
  // Keep legacy extra/config behavior untouched; never interpret a different native flow as upfront.
  if ('amount' in requirement && getNetworkType(requirement.network) === 'fast' && requirement.extra?.paymentFlow !== 'upfront') {
    throw new Error('Unsupported native Fast payment flow');
  }
  if (payload.x402Version === 2) {
    const accepted = (payload as PaymentPayloadV2).accepted;
    if (getNetworkType(accepted.network) === 'fast' && accepted.extra?.paymentFlow !== 'upfront') {
      throw new Error('Unsupported native Fast payment flow');
    }
  }
  let expected: PaymentRequirement;
  if ('amount' in requirement) {
    expected = fromV2(requirement as PaymentRequirementV2);
    // Preserve the configured v1 key (notably the sepolia alias).
    const keys = [...Object.keys(config.evmChains ?? {}), ...Object.keys(config.fastNetworks ?? {})];
    const configured = keys.find((key) => {
      try {
        return toCanonicalNetwork(key) === requirement.network;
      } catch {
        return false;
      }
    });
    if (configured) expected = { ...expected, network: configured };
  } else {
    expected = requirement as PaymentRequirement;
  }
  return {
    payload: payload.x402Version === 2 ? fromV2PaymentPayload(payload as PaymentPayloadV2, expected) : (payload as PaymentPayload),
    requirement: expected,
  };
}
