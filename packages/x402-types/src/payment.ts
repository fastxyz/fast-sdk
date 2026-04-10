/**
 * x402 Payment Protocol types
 *
 * Unified types used across client, server, and facilitator.
 */

// ─── Payment Requirement ──────────────────────────────────────────────────────

/**
 * Payment requirement returned in a 402 response.
 *
 * This is the single, canonical definition — used by server (to create),
 * client (to consume), and facilitator (to verify/settle).
 */
export interface PaymentRequirement {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
}

// ─── Payment Payloads ─────────────────────────────────────────────────────────

/**
 * Decoded X-PAYMENT header payload.
 */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown;
}

/**
 * Fast transaction certificate payload (inside PaymentPayload.payload).
 */
export interface FastPayload {
  transactionCertificate: {
    envelope: unknown;
    signatures: unknown[];
  };
}

/**
 * EVM EIP-3009 authorization payload (inside PaymentPayload.payload).
 */
export interface EvmPayload {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

// ─── Facilitator Responses ────────────────────────────────────────────────────

/**
 * Verify response from the facilitator.
 */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  network?: string;
}

/**
 * Settle response from the facilitator.
 */
export interface SettleResponse {
  success: boolean;
  transaction?: string;
  txHash?: string;
  errorReason?: string;
  network?: string;
  payer?: string;
}

// ─── Supported Payment Kinds ──────────────────────────────────────────────────

/**
 * Descriptor for a supported payment kind (returned by facilitator /supported).
 */
export interface SupportedPaymentKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

// ─── Network Type ─────────────────────────────────────────────────────────────

export type NetworkType = 'evm' | 'fast' | 'svm';

/**
 * Determine network type from a network identifier string.
 */
export function getNetworkType(network: string): NetworkType {
  if (network.startsWith('fast-')) return 'fast';
  if (network.startsWith('solana')) return 'svm';
  return 'evm';
}
