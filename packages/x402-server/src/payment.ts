/**
 * x402-server payment functions
 *
 * Core functions for creating 402 responses and verifying payments.
 * No hardcoded network configs — all asset info comes from RouteConfig.networkConfig.
 */

import type { PaymentRequirement, VerifyResponse, SettleResponse } from '@fastxyz/x402-types';
import { parsePrice, encodePayload, decodePayload } from '@fastxyz/x402-types';

import type { PaymentRequiredResponse, FacilitatorConfig, PaymentResponse, XPaymentPayload, RouteConfig } from './types.js';

/**
 * Create a payment requirement for a resource.
 */
export function createPaymentRequirement(payTo: string, config: RouteConfig, resource: string): PaymentRequirement {
  const { networkConfig } = config;
  const amount = parsePrice(config.price, networkConfig.decimals);

  return {
    scheme: 'exact',
    network: config.network,
    maxAmountRequired: amount,
    resource,
    description: config.config?.description || `Access to ${resource}`,
    mimeType: config.config?.mimeType || 'application/json',
    payTo,
    maxTimeoutSeconds: 60,
    asset: config.config?.asset || networkConfig.asset,
    ...(networkConfig.extra && { extra: networkConfig.extra }),
  };
}

/**
 * Create a 402 Payment Required response body.
 */
export function createPaymentRequired(payTo: string, config: RouteConfig, resource: string): PaymentRequiredResponse {
  return {
    error: 'X-PAYMENT header is required',
    accepts: [createPaymentRequirement(payTo, config, resource)],
  };
}

/**
 * Parse X-PAYMENT header.
 */
export function parsePaymentHeader(header: string): XPaymentPayload {
  return decodePayload<XPaymentPayload>(header);
}

/**
 * Verify a payment with the facilitator.
 */
export async function verifyPayment(
  paymentHeader: string,
  paymentRequirement: PaymentRequirement,
  facilitator: FacilitatorConfig,
): Promise<VerifyResponse> {
  const authHeaders = (await facilitator.createAuthHeaders?.()) || {};

  const response = await fetch(`${facilitator.url}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders.verify,
    },
    body: JSON.stringify({
      paymentPayload: paymentHeader,
      paymentRequirements: paymentRequirement,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      isValid: false,
      invalidReason: `Facilitator error: ${response.status} ${text}`,
    };
  }

  return response.json() as Promise<VerifyResponse>;
}

/**
 * Settle a payment with the facilitator (submit on-chain).
 */
export async function settlePayment(
  paymentHeader: string,
  paymentRequirement: PaymentRequirement,
  facilitator: FacilitatorConfig,
): Promise<SettleResponse> {
  const authHeaders = (await facilitator.createAuthHeaders?.()) || {};

  const response = await fetch(`${facilitator.url}/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders.settle,
    },
    body: JSON.stringify({
      paymentPayload: paymentHeader,
      paymentRequirements: paymentRequirement,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      success: false,
      errorReason: `Facilitator error: ${response.status} ${text}`,
    };
  }

  const result = (await response.json()) as SettleResponse;

  // Normalize txHash field (facilitator might return "transaction" instead)
  return {
    ...result,
    txHash: result.txHash || ((result as unknown as Record<string, unknown>).transaction as string | undefined),
  };
}

/**
 * Encode X-PAYMENT-RESPONSE header.
 */
export function encodePaymentResponse(response: PaymentResponse): string {
  return encodePayload(response);
}

/**
 * Verify and settle a payment in one operation.
 */
export async function verifyAndSettle(
  paymentHeader: string,
  paymentRequirement: PaymentRequirement,
  facilitator: FacilitatorConfig,
): Promise<PaymentResponse> {
  const verifyResult = await verifyPayment(paymentHeader, paymentRequirement, facilitator);

  if (!verifyResult.isValid) {
    return {
      success: false,
      errorMessage: verifyResult.invalidReason || 'Payment verification failed',
      network: verifyResult.network,
      payer: verifyResult.payer,
    };
  }

  const settleResult = await settlePayment(paymentHeader, paymentRequirement, facilitator);

  return {
    success: settleResult.success,
    txHash: settleResult.txHash,
    network: settleResult.network || verifyResult.network,
    payer: settleResult.payer || verifyResult.payer,
    errorMessage: settleResult.errorReason,
  };
}
