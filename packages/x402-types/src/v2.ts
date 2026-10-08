import type { PaymentRequirement, PaymentPayload, SettleResponse } from './payment.js';
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
export interface ResourceInfoV2 {
  url: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
}
export interface PaymentRequirementV2 {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface PaymentRequiredV2 {
  x402Version: 2;
  resource: ResourceInfoV2;
  accepts: PaymentRequirementV2[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface PaymentPayloadV2 {
  x402Version: 2;
  accepted: PaymentRequirementV2;
  payload: unknown;
  resource?: ResourceInfoV2;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}
export const LEGACY_TO_CAIP_NETWORK: Readonly<Record<string, string>> = Object.freeze({
  'fast-mainnet': 'fast:mainnet',
  'fast-testnet': 'fast:testnet',
  arbitrum: 'eip155:42161',
  'arbitrum-sepolia': 'eip155:421614',
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  ethereum: 'eip155:1',
  'ethereum-sepolia': 'eip155:11155111',
  sepolia: 'eip155:11155111',
  polygon: 'eip155:137',
  'polygon-amoy': 'eip155:80002',
});
const networks = LEGACY_TO_CAIP_NETWORK;
const hasNetwork = (key: string) => Object.prototype.hasOwnProperty.call(networks, key);
/** JSON object key ordering is not part of payment terms. Arrays remain ordered. */
export function equalPaymentMetadata(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalPaymentMetadata(v, b[i]));
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  const keys = Object.keys(aa);
  return (
    keys.length === Object.keys(bb).length && keys.every((k) => Object.prototype.hasOwnProperty.call(bb, k) && equalPaymentMetadata(aa[k], bb[k]))
  );
}
export function toCanonicalNetwork(network: string): string {
  if (hasNetwork(network)) return networks[network];
  if (Object.values(networks).includes(network)) return network;
  throw new Error('Unsupported x402 network mapping');
}
export function toLegacyNetwork(network: string): string {
  const legacy = Object.keys(networks).find((key) => networks[key] === network);
  if (legacy) return legacy;
  if (hasNetwork(network)) return network;
  throw new Error('Unsupported x402 network mapping');
}
export function validateV2Requirement(value: unknown): asserts value is PaymentRequirementV2 {
  if (!value || typeof value !== 'object') throw new Error('Invalid v2 requirement');
  const r = value as PaymentRequirementV2;
  if (
    r.scheme !== 'exact' ||
    typeof r.network !== 'string' ||
    toCanonicalNetwork(r.network) !== r.network ||
    typeof r.amount !== 'string' ||
    !/^\d+$/.test(r.amount) ||
    !r.asset ||
    typeof r.asset !== 'string' ||
    !r.payTo ||
    typeof r.payTo !== 'string' ||
    !Number.isInteger(r.maxTimeoutSeconds) ||
    r.maxTimeoutSeconds <= 0 ||
    (r.extra !== undefined && (!r.extra || typeof r.extra !== 'object' || Array.isArray(r.extra)))
  )
    throw new Error('Invalid v2 requirement');
}
export function validatePaymentRequiredV2(value: unknown): asserts value is PaymentRequiredV2 {
  const r = value as PaymentRequiredV2;
  if (
    !r ||
    r.x402Version !== 2 ||
    !r.resource ||
    typeof r.resource.url !== 'string' ||
    (r.resource.description !== undefined && typeof r.resource.description !== 'string') ||
    (r.resource.mimeType !== undefined && typeof r.resource.mimeType !== 'string') ||
    !Array.isArray(r.accepts) ||
    !r.accepts.length
  )
    throw new Error('Invalid v2 payment required');
  r.accepts.forEach(validateV2Requirement);
}
/** Release 1 shortcut: native v2 is normalized into the unchanged v1 runtime. */
export function fromV2(r: PaymentRequirementV2, resource?: ResourceInfoV2): PaymentRequirement {
  validateV2Requirement(r);
  return {
    scheme: 'exact',
    network: toLegacyNetwork(r.network),
    maxAmountRequired: r.amount,
    asset: r.asset,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    resource: resource?.url ?? '',
    description: resource?.description ?? '',
    mimeType: resource?.mimeType ?? '',
    ...(r.extra !== undefined && { extra: structuredClone(r.extra) }),
    originalV2Requirement: structuredClone(r),
    originalV2Resource: resource === undefined ? undefined : structuredClone(resource),
  };
}
export function assertOriginalV2Requirement(r: {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset?: string;
  payTo: string;
  extra?: unknown;
  maxTimeoutSeconds?: number;
  originalV2Requirement?: PaymentRequirementV2;
}): void {
  const o = r.originalV2Requirement;
  if (!o) throw new Error('Missing original v2 payment requirement');
  validateV2Requirement(o);
  if (
    o.scheme !== r.scheme ||
    o.network !== toCanonicalNetwork(r.network) ||
    o.amount !== r.maxAmountRequired ||
    o.asset !== r.asset ||
    o.payTo !== r.payTo ||
    (r.maxTimeoutSeconds !== undefined && o.maxTimeoutSeconds !== r.maxTimeoutSeconds) ||
    !equalPaymentMetadata(o.extra, r.extra)
  )
    throw new Error('Original v2 payment requirement mismatch');
}
export function toV2(r: PaymentRequirement): PaymentRequirementV2 {
  if (r.originalV2Requirement) {
    assertOriginalV2Requirement(r);
    return r.originalV2Requirement;
  }
  return {
    scheme: r.scheme,
    network: toCanonicalNetwork(r.network),
    amount: r.maxAmountRequired,
    asset: r.asset,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    ...(r.extra !== undefined && { extra: r.extra }),
    ...(r.network.startsWith('fast') && { extra: { ...r.extra, paymentFlow: 'upfront' } }),
  };
}
export function fromV2PaymentPayload(value: PaymentPayloadV2, expected: PaymentRequirement): PaymentPayload {
  if (value.x402Version !== 2) throw new Error('Unsupported x402 protocol version');
  const accepted = fromV2(value.accepted);
  if (
    accepted.scheme !== expected.scheme ||
    toCanonicalNetwork(accepted.network) !== toCanonicalNetwork(expected.network) ||
    accepted.maxAmountRequired !== expected.maxAmountRequired ||
    accepted.asset !== expected.asset ||
    accepted.payTo !== expected.payTo ||
    accepted.maxTimeoutSeconds !== expected.maxTimeoutSeconds ||
    !equalPaymentMetadata(accepted.extra, toV2(expected).extra)
  )
    throw new Error('Accepted payment requirement mismatch');
  return { x402Version: 1, scheme: accepted.scheme, network: expected.network, payload: value.payload };
}
export function toV2PaymentPayload(payload: PaymentPayload, accepted: PaymentRequirementV2, resource?: ResourceInfoV2): PaymentPayloadV2 {
  validateV2Requirement(accepted);
  return { x402Version: 2, accepted, payload: payload.payload, ...(resource && { resource }) };
}
export function toV2SettleResponse(response: SettleResponse): SettleResponse {
  return {
    ...response,
    transaction: response.transaction ?? response.txHash ?? '',
    ...(response.network && { network: toCanonicalNetwork(response.network) }),
  };
}
