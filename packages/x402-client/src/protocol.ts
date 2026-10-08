import {
  assertOriginalV2Requirement,
  toV2PaymentPayload,
  validatePaymentRequiredV2,
  toLegacyNetwork,
  toCanonicalNetwork,
  equalPaymentMetadata,
} from '@fastxyz/x402-types';
import type { PaymentPayload, EvmChainConfig } from '@fastxyz/x402-types';
import type { PaymentRequired, ClientPaymentRequirement } from './types.js';

/** Validate before any signing, bridging or submission, not only serialization. */
export function validateRequestedProtocol(required: PaymentRequired, requirement: ClientPaymentRequirement): void {
  const version = required.x402Version ?? 1;
  if (version !== 1 && version !== 2) throw new Error('Unsupported x402 protocol version');
  if (version === 1) return;
  assertOriginalV2Requirement(requirement);
  if (!required.originalV2) throw new Error('Missing original v2 payment envelope');
  validatePaymentRequiredV2(required.originalV2);
  if (
    !required.originalV2.accepts.some((o) => equalPaymentMetadata(o, requirement.originalV2Requirement)) ||
    !equalPaymentMetadata(required.originalV2.resource, requirement.originalV2Resource)
  ) {
    throw new Error('Original v2 payment envelope mismatch');
  }
  if (requirement.network.startsWith('fast') && requirement.originalV2Requirement!.extra?.paymentFlow !== 'upfront') {
    throw new Error('Unsupported Fast v2 payment flow');
  }
}
export function requestedPaymentPayload(required: PaymentRequired, requirement: ClientPaymentRequirement, payload: PaymentPayload): unknown {
  validateRequestedProtocol(required, requirement);
  return required.x402Version === 2
    ? toV2PaymentPayload(payload, requirement.originalV2Requirement!, required.originalV2!.resource)
    : { ...payload, x402Version: 1 };
}
export function readPaymentReceipt(response: Response): { txHash?: string; network?: string } | undefined {
  const header = response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('X-PAYMENT-RESPONSE');
  if (!header) return undefined;
  try {
    const receipt = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    const validHash = (hash: unknown): hash is string => typeof hash === 'string' && hash.trim().length > 0;
    let network: string | undefined;
    if (typeof receipt.network === 'string' && receipt.network.length > 0) {
      try {
        network = toLegacyNetwork(receipt.network);
      } catch {
        // Receipt presentation must not discard a valid hash for a custom v1 network.
        network = receipt.network;
      }
    }
    return {
      txHash: validHash(receipt.transaction) ? receipt.transaction : validHash(receipt.txHash) ? receipt.txHash : undefined,
      ...(network && { network }),
    };
  } catch {
    return undefined;
  }
}
/** Keep caller configuration aliases at the legacy runtime boundary. */
export function resolveEvmNetworkConfig(
  network: string,
  configs?: Record<string, EvmChainConfig>,
): { network: string; config: EvmChainConfig } | undefined {
  if (!configs) return undefined;
  if (Object.prototype.hasOwnProperty.call(configs, network)) return { network, config: configs[network] };
  let canonical: string;
  try {
    canonical = toCanonicalNetwork(network);
  } catch {
    return undefined;
  }
  for (const [key, config] of Object.entries(configs)) {
    try {
      if (toCanonicalNetwork(key) === canonical) return { network: key, config };
    } catch {
      /* Custom v1 keys remain usable by exact match only. */
    }
  }
  return undefined;
}
